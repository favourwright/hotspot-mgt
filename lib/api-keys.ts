/**
 * API keys: how a tenant's own systems authenticate to /api/v1.
 *
 * ## Shape
 *
 *   ogw_live_<keyId: 16 base62>_<secret: 32 base62>
 *
 * Base62 for both parts, so splitting on `_` is unambiguous (base64url
 * secrets contain underscores, and a split that cut one in half would
 * reject a good key or, worse, accept a bad one). The key id names the
 * record, so verifying a key is one read by id, never a query by hash.
 *
 * ## Storage
 *
 * `apiKeys/{keyId}`, top-level, server-only. Only a SHA-256 of the secret
 * is kept. A slow hash (bcrypt, argon2) protects low-entropy passwords; a
 * 190-bit random secret needs no stretching, and hashing every request
 * with one would be a self-inflicted denial of service. The full key is
 * shown once, at creation, and never again.
 *
 * `tenantId` comes from the record and nowhere else: nothing in a request
 * can choose which tenant a key acts for.
 *
 * ## Revocation
 *
 * Records are cached in process (lib/doc-cache.ts). Revoking invalidates,
 * and the app is one process, so a revoked key stops on its very next
 * request; the TTL is only the backstop the cache's contract requires.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { createDocCache } from "@/lib/doc-cache";
import { isRateLimited, rateLimit } from "@/lib/rate-limit";
import { createWithinCapacity } from "@/lib/tenant-capacity";

export const API_SCOPES = [
  "plans:read",
  "locations:read",
  "vouchers:read",
  "payments:read",
  "customers:read",
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function isApiScope(value: string): value is ApiScope {
  return (API_SCOPES as readonly string[]).includes(value);
}

/** Per tenant, so a leaked-and-recreated cycle cannot pile up unnoticed. */
export const MAX_ACTIVE_KEYS = 10;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_PATTERN = /^ogw_(live)_([0-9A-Za-z]{16})_([0-9A-Za-z]{32})$/;

/** Uniformly random base62: bytes of 248 and up are discarded, not wrapped. */
export function randomBase62(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function parseApiKey(
  raw: string
): { environment: "live"; keyId: string; secret: string } | null {
  const match = KEY_PATTERN.exec(raw);
  if (!match) return null;
  return { environment: "live", keyId: match[2], secret: match[3] };
}

/** Constant time, and false rather than a throw on any shape problem. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const given = Buffer.from(hashSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === 32 && stored.length === 32 && timingSafeEqual(given, stored);
}

/** What the owner's list shows instead of the key. */
export function maskedKey(keyId: string, last4: string): string {
  return `ogw_live_${keyId}_${"•".repeat(4)}${last4}`;
}

export interface ApiKeyRecord {
  keyId: string;
  tenantId: string;
  name: string;
  scopes: ApiScope[];
  environment: "live";
  secretHash: string;
  last4: string;
  createdBy: string;
  createdAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  requestCount: number;
}

export interface ApiKeyView {
  keyId: string;
  name: string;
  masked: string;
  scopes: ApiScope[];
  createdAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  requestCount: number;
}

export function keyView(k: ApiKeyRecord): ApiKeyView {
  return {
    keyId: k.keyId,
    name: k.name,
    masked: maskedKey(k.keyId, k.last4),
    scopes: k.scopes,
    createdAt: k.createdAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    requestCount: k.requestCount,
  };
}

/* ------------------------------------------------ storage */

const keyCache = createDocCache<ApiKeyRecord | null>(5 * 60 * 1000, { maxEntries: 2_000 });

/**
 * Lookups that found no key, across the whole platform, before uncached
 * lookups stop reading Firestore.
 *
 * A key id is whatever the request sent, and finding out it does not exist
 * costs a document read from the daily quota every page shares, before any
 * per-key or per-tenant limit can apply. A flood of made-up keys from many
 * addresses would spend that quota for everyone, which is the very thing
 * the API's read budget exists to prevent (lib/public-api.ts). Real keys
 * never count against this; only misses do. Past it, a key not already in
 * the cache is refused without a read until the hour rolls on, and keys in
 * use keep working from the cache.
 */
const KEY_MISS_BUDGET = { max: 200, windowMs: 60 * 60 * 1000 };

export class KeyLookupThrottledError extends Error {
  constructor() {
    super("API key lookups are throttled");
    this.name = "KeyLookupThrottledError";
  }
}

export async function getApiKey(keyId: string): Promise<ApiKeyRecord | null> {
  return keyCache.get(keyId, async () => {
    if (isRateLimited("api:key-miss", KEY_MISS_BUDGET)) {
      console.warn("[api] key miss budget spent; refusing uncached key lookups");
      throw new KeyLookupThrottledError();
    }
    const snap = await adminDb.collection(COLLECTIONS.API_KEYS).doc(keyId).get();
    if (!snap.exists) rateLimit("api:key-miss", KEY_MISS_BUDGET);
    return snap.exists ? fromData(keyId, snap.data()!) : null;
  });
}

/**
 * A tenant's keys that still work. What `MAX_ACTIVE_KEYS` counts. Its own
 * query rather than a filter over the tenant's keys, because revoked keys
 * are kept: a tenant who has made and revoked a hundred of them would
 * otherwise have the active ones fall outside whatever page was read.
 */
function activeKeysQuery(tenantId: string) {
  return adminDb
    .collection(COLLECTIONS.API_KEYS)
    .where("tenantId", "==", tenantId)
    .where("revokedAt", "==", null);
}

export async function listTenantKeys(tenantId: string): Promise<ApiKeyRecord[]> {
  // No orderBy: a where plus an orderBy on another field needs a composite
  // index, and a tenant has at most a handful of keys to sort in memory.
  // Every active key, always; revoked ones as history, up to a page of them.
  const [active, all] = await Promise.all([
    activeKeysQuery(tenantId).limit(MAX_ACTIVE_KEYS + 5).get(),
    adminDb.collection(COLLECTIONS.API_KEYS).where("tenantId", "==", tenantId).limit(100).get(),
  ]);
  const byId = new Map<string, ApiKeyRecord>();
  for (const d of [...active.docs, ...all.docs]) byId.set(d.id, fromData(d.id, d.data()));
  return [...byId.values()].sort(
    (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
  );
}

export async function createApiKey(args: {
  tenantId: string;
  name: string;
  scopes: ApiScope[];
  createdBy: string;
}): Promise<{ key: string; record: ApiKeyRecord }> {
  const keyId = randomBase62(16);
  const secret = randomBase62(32);
  const data = {
    tenantId: args.tenantId,
    name: args.name,
    scopes: args.scopes,
    environment: "live" as const,
    secretHash: hashSecret(secret),
    last4: secret.slice(-4),
    createdBy: args.createdBy,
    createdAt: FieldValue.serverTimestamp(),
    revokedAt: null,
    lastUsedAt: null,
    requestCount: 0,
  };
  const ref = adminDb.collection(COLLECTIONS.API_KEYS).doc(keyId);
  await createWithinCapacity({
    tenantId: args.tenantId,
    resource: "apiKeys",
    checks: [
      {
        counted: activeKeysQuery(args.tenantId),
        allowed: MAX_ACTIVE_KEYS,
        fullMessage: `You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
      },
    ],
    write: (tx) => tx.create(ref, data),
  });
  return {
    key: `ogw_live_${keyId}_${secret}`,
    record: { ...data, keyId, createdAt: new Date(), revokedAt: null, lastUsedAt: null },
  };
}

export async function revokeApiKey(tenantId: string, keyId: string): Promise<boolean> {
  const ref = adminDb.collection(COLLECTIONS.API_KEYS).doc(keyId);
  const revoked = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Another tenant's key id is "not found", never "not yours".
    if (!snap.exists || snap.data()?.tenantId !== tenantId) return false;
    if (!snap.data()?.revokedAt) tx.update(ref, { revokedAt: FieldValue.serverTimestamp() });
    return true;
  });
  keyCache.invalidate(keyId);
  return revoked;
}

/* ------------------------------------------------ usage */

/**
 * `lastUsedAt` and the request count, written at most once a minute per
 * key. A write per request would make each key a hot document and spend
 * the project's daily write quota on bookkeeping.
 */
const usage = new Map<string, { pending: number; lastFlush: number }>();
const USAGE_FLUSH_MS = 60_000;

export function recordKeyUse(
  keyId: string,
  defer: (task: () => Promise<void>) => void,
  now = Date.now()
): void {
  const entry = usage.get(keyId) ?? { pending: 0, lastFlush: 0 };
  entry.pending += 1;
  // Re-inserted so the map's first key is the least recently used, and
  // bounded by dropping that one: losing an idle key's unflushed count is
  // a slightly low statistic, never a wrong permission.
  usage.delete(keyId);
  usage.set(keyId, entry);
  while (usage.size > 5000) {
    const oldest = usage.keys().next().value;
    if (oldest === undefined) break;
    usage.delete(oldest);
  }
  if (now - entry.lastFlush < USAGE_FLUSH_MS) return;

  const count = entry.pending;
  entry.pending = 0;
  entry.lastFlush = now;
  defer(async () => {
    await adminDb
      .collection(COLLECTIONS.API_KEYS)
      .doc(keyId)
      .update({ lastUsedAt: new Date(now), requestCount: FieldValue.increment(count) });
  });
}

function fromData(keyId: string, d: FirebaseFirestore.DocumentData): ApiKeyRecord {
  return {
    keyId,
    tenantId: d.tenantId,
    name: d.name ?? "",
    scopes: (Array.isArray(d.scopes) ? d.scopes : []).filter(isApiScope),
    environment: "live",
    secretHash: d.secretHash ?? "",
    last4: d.last4 ?? "",
    createdBy: d.createdBy ?? "",
    createdAt: toDate(d.createdAt),
    revokedAt: toDate(d.revokedAt),
    lastUsedAt: toDate(d.lastUsedAt),
    requestCount: typeof d.requestCount === "number" ? d.requestCount : 0,
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}
