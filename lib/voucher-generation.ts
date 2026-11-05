/**
 * Tenant voucher generation, the server half. The arithmetic is in
 * lib/voucher-generation-rules.ts and the router discipline in
 * lib/voucher-batch-runner.ts; this file is the Firestore and router wiring.
 * docs/voucher-generation.md has the why.
 *
 * The shape, in one paragraph: a batch document holds every code it will
 * create, with passwords, before the router is touched. The runner puts
 * them on the router as `vc` users and lists each one in a per-router index
 * of unused codes. Nothing else in the app sees an unused code - no voucher
 * document, no count, no list - until somebody logs in with one. Then the
 * profile's on-login script stamps the expiry into the router comment, the
 * router-health cron notices that against the index, and writes an ordinary
 * voucher document (`source: "generated"`), from which point expiry,
 * close-out, reap, drift and Recreate treat it like any other login.
 */

import { createHash } from "crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { AuthError } from "@/lib/auth-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  createHotspotUser,
  deleteHotspotUser,
  findHotspotUser,
  parseDataLimitBytes,
  type HotspotUser,
  type RouterConfig,
} from "@/lib/mikrotik";
import { getPlatformConfig } from "@/lib/platform-config";
import { routerLogin } from "@/lib/router-credentials";
import {
  BATCH_LEASE_MS,
  findActivations,
  generatedVoucherId,
  runBatch,
  type BatchCode,
  type BatchRouter,
  type BatchRunOutcome,
  type VoucherBatch,
} from "@/lib/voucher-batch-runner";
import {
  DEFAULT_CODE_FORMAT,
  generateCredential,
  generateCredentials,
  generationCycle,
  releaseQuota,
  reserveQuota,
  type GenerationCycle,
} from "@/lib/voucher-generation-rules";
import { GeneratedCodeFormatSchema, type GeneratedCodeFormat } from "@/types/schemas";

/** The credit meter generation draws on. Credits are per meter, not global. */
export const GENERATION_METER = "voucher-generation";

export class GenerationError extends AuthError {
  constructor(
    message: string,
    status = 400,
    readonly code: "quota" | "router-full" | "invalid" | "not-found" | "in-use" = "invalid"
  ) {
    super(message, status);
    this.name = "GenerationError";
  }
}

/* ------------------------------------------------------------- helpers */

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function routerConfigOf(data: FirebaseFirestore.DocumentData): RouterConfig {
  return { ip: data.routerIp, ...routerLogin(data) };
}

function batchesRef(tenantId: string) {
  return adminDb.collection(TENANT_COLLECTIONS.voucherBatches(tenantId));
}

function indexRef(tenantId: string, routerId: string) {
  return adminDb.collection(TENANT_COLLECTIONS.generatedCodeIndex(tenantId)).doc(routerId);
}

function creditsRef(tenantId: string) {
  return adminDb.collection(TENANT_COLLECTIONS.credits(tenantId)).doc(GENERATION_METER);
}

/** `username:batchId`. An array of these, not a map: see `readIndex`. */
function indexEntry(username: string, batchId: string): string {
  return `${username}:${batchId}`;
}

/**
 * The router's unused codes, username to batch id.
 *
 * Stored as an array of strings rather than a map because a map key is a
 * Firestore field, and a document may hold at most 20,000 fields and 40,000
 * index entries: a busy router would hit that before the 1 MiB size limit.
 * The array field is exempted from indexing in firestore.indexes.json.
 */
async function readIndex(
  tenantId: string,
  routerId: string,
  tx?: FirebaseFirestore.Transaction
): Promise<Record<string, string>> {
  const ref = indexRef(tenantId, routerId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  const out: Record<string, string> = {};
  for (const entry of (snap.get("entries") as string[] | undefined) ?? []) {
    const at = entry.lastIndexOf(":");
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return out;
}

function parseBatch(doc: FirebaseFirestore.DocumentSnapshot): VoucherBatch | null {
  if (!doc.exists) return null;
  const d = doc.data()!;
  return {
    id: doc.id,
    tenantId: d.tenantId,
    locationId: d.locationId,
    locationName: d.locationName,
    routerId: d.routerId,
    plan: d.plan,
    count: d.count,
    codes: ((d.codes ?? []) as Array<Record<string, unknown>>).map((c) => ({
      username: String(c.username),
      password: String(c.password),
      status: c.status as BatchCode["status"],
      error: (c.error as string | null) ?? null,
      voucherId: (c.voucherId as string | null) ?? null,
      activatedAt: toDate(c.activatedAt),
      voidedAt: toDate(c.voidedAt),
    })),
    state: d.state,
    leaseUntil: toDate(d.leaseUntil),
    attempts: d.attempts ?? 0,
    reservation: d.reservation,
    released: d.released === true,
    createdBy: d.createdBy,
    createdAt: toDate(d.createdAt) ?? new Date(0),
    finishedAt: toDate(d.finishedAt),
  };
}

/** Firestore rejects `undefined`; every code field is written explicitly. */
function serialiseCodes(codes: BatchCode[]): Array<Record<string, unknown>> {
  return codes.map((c) => ({
    username: c.username,
    password: c.password,
    status: c.status,
    error: c.error,
    voucherId: c.voucherId,
    activatedAt: c.activatedAt,
    voidedAt: c.voidedAt,
  }));
}

/* --------------------------------------------------------------- quota */

interface QuotaContext {
  cycle: GenerationCycle;
  allowance: number | null;
  planName: string | null;
}

async function quotaContext(tenantId: string, now: Date): Promise<QuotaContext> {
  const tenantDoc = await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
  const tenant = tenantDoc.data();
  if (!tenant) throw new GenerationError("Tenant not found", 404, "not-found");

  const plan = tenant.planId ? await getBillingPlanById(tenant.planId) : null;
  // No plan means no allowance, not unlimited: credits still work.
  const allowance = plan ? plan.limits.maxGeneratedVouchers : 0;

  return {
    cycle: generationCycle(now, {
      nextBillingDate: toDate(tenant.nextBillingDate),
      billingInterval: plan?.billingInterval ?? "monthly",
      tenantCreatedAt: toDate(tenant.createdAt) ?? now,
    }),
    allowance,
    planName: plan?.name ?? null,
  };
}

export interface GenerationQuotaView {
  cycleStart: string;
  cycleEnd: string;
  /** Per cycle; null is unlimited. */
  allowance: number | null;
  usedThisCycle: number;
  credits: number;
  /** Allowance left plus credits; null is unlimited. */
  available: number | null;
  planName: string | null;
}

export async function getGenerationQuota(tenantId: string): Promise<GenerationQuotaView> {
  const ctx = await quotaContext(tenantId, new Date());
  const [usage, credits] = await Promise.all([
    adminDb.collection(TENANT_COLLECTIONS.generationUsage(tenantId)).doc(ctx.cycle.key).get(),
    creditsRef(tenantId).get(),
  ]);
  const used = Number(usage.get("used") ?? 0);
  const balance = Number(credits.get("balance") ?? 0);
  return {
    cycleStart: ctx.cycle.start.toISOString(),
    cycleEnd: ctx.cycle.end.toISOString(),
    allowance: ctx.allowance,
    usedThisCycle: used,
    credits: balance,
    available: ctx.allowance === null ? null : Math.max(0, ctx.allowance - used) + Math.max(0, balance),
    planName: ctx.planName,
  };
}

/* ------------------------------------------------------------- format */

export async function getCodeFormat(tenantId: string): Promise<GeneratedCodeFormat> {
  const doc = await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
  const parsed = GeneratedCodeFormatSchema.safeParse(doc.get("generatedCodeFormat"));
  return parsed.success ? parsed.data : DEFAULT_CODE_FORMAT;
}

export async function setCodeFormat(tenantId: string, format: GeneratedCodeFormat): Promise<void> {
  await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
    generatedCodeFormat: format,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/* ------------------------------------------------------------ creating */

/**
 * The batch id, derived from the request id the page sends. A double click
 * or a retried request names the same batch, and the transaction below
 * finds it already exists instead of charging twice.
 */
export function batchIdFor(tenantId: string, requestId: string): string {
  return "b" + createHash("sha256").update(`${tenantId}:${requestId}`).digest("hex").slice(0, 20);
}

export async function createBatch(params: {
  tenantId: string;
  createdBy: { uid: string; email: string | null };
  locationId: string;
  planId: string;
  count: number;
  requestId: string;
}): Promise<{ batchId: string; created: boolean }> {
  const { tenantId, locationId, planId, count } = params;
  const limits = (await getPlatformConfig()).voucherGeneration;

  if (!Number.isInteger(count) || count < 1 || count > limits.maxBatchSize) {
    throw new GenerationError(`A batch can hold between 1 and ${limits.maxBatchSize} codes.`);
  }

  const batchId = batchIdFor(tenantId, params.requestId);
  const existing = await batchesRef(tenantId).doc(batchId).get();
  if (existing.exists) return { batchId, created: false };

  const [locationDoc, planDoc] = await Promise.all([
    adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).doc(locationId).get(),
    adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(planId).get(),
  ]);
  const location = locationDoc.data();
  const plan = planDoc.data();
  if (!location || location.active === false) {
    throw new GenerationError("That location is not available.", 404, "not-found");
  }
  if (!plan || plan.locationId !== locationId) {
    throw new GenerationError("That plan does not belong to this location.", 404, "not-found");
  }
  if (plan.active === false) {
    throw new GenerationError("That plan is switched off. Switch it on to generate codes for it.");
  }
  const routerId = location.routerId as string | undefined;
  const routerDoc = routerId
    ? await adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).doc(routerId).get()
    : null;
  if (!routerId || !routerDoc?.exists || routerDoc.get("active") === false) {
    throw new GenerationError("This location has no active router to put the codes on.");
  }

  const index = await readIndex(tenantId, routerId);
  const unusedOnRouter = Object.keys(index).length;
  if (unusedOnRouter + count > limits.maxUnusedPerRouter) {
    throw new GenerationError(
      `This router already holds ${unusedOnRouter} unused codes, and the limit is ${limits.maxUnusedPerRouter}. ` +
        `Void codes you no longer need, or generate fewer.`,
      409,
      "router-full"
    );
  }

  const format = await getCodeFormat(tenantId);
  const credentials = generateCredentials(format, count, new Set(Object.keys(index)));
  const now = new Date();
  const ctx = await quotaContext(tenantId, now);

  const codes: BatchCode[] = credentials.map((c) => ({
    username: c.username,
    password: c.password,
    status: "pending",
    error: null,
    voucherId: null,
    activatedAt: null,
    voidedAt: null,
  }));

  const usageRef = adminDb
    .collection(TENANT_COLLECTIONS.generationUsage(tenantId))
    .doc(ctx.cycle.key);
  const balanceRef = creditsRef(tenantId);
  const ref = batchesRef(tenantId).doc(batchId);

  const created = await adminDb.runTransaction(async (tx) => {
    const [batchSnap, usageSnap, creditSnap] = await Promise.all([
      tx.get(ref),
      tx.get(usageRef),
      tx.get(balanceRef),
    ]);
    if (batchSnap.exists) return false;

    const reservation = reserveQuota(
      {
        allowance: ctx.allowance,
        usedThisCycle: Number(usageSnap.get("used") ?? 0),
        credits: Number(creditSnap.get("balance") ?? 0),
      },
      count
    );
    if (!reservation) {
      throw new GenerationError(
        "Not enough generation quota left. Generate fewer codes, wait for your next billing cycle, or ask us for top-up credits.",
        409,
        "quota"
      );
    }

    if (reservation.fromAllowance > 0) {
      tx.set(
        usageRef,
        {
          used: FieldValue.increment(reservation.fromAllowance),
          cycleStart: ctx.cycle.start,
          cycleEnd: ctx.cycle.end,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    if (reservation.fromCredits > 0) {
      tx.set(
        balanceRef,
        { balance: FieldValue.increment(-reservation.fromCredits), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.create(adminDb.collection(TENANT_COLLECTIONS.creditLedger(tenantId)).doc(), {
        meter: GENERATION_METER,
        delta: -reservation.fromCredits,
        kind: "consume",
        batchId,
        by: params.createdBy,
        note: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    tx.create(ref, {
      tenantId,
      locationId,
      locationName: location.name ?? "Location",
      routerId,
      plan: {
        id: planDoc.id,
        name: plan.name,
        duration: plan.duration,
        dataLimit: plan.dataLimit ?? null,
        sharedUsers: plan.sharedUsers ?? null,
        mikrotikProfile: plan.mikrotikProfile,
        routerDurationValue: plan.routerDurationValue ?? null,
        routerDurationUnit: plan.routerDurationUnit ?? null,
      },
      count,
      format,
      codes: serialiseCodes(codes),
      state: "minting",
      leaseUntil: null,
      attempts: 0,
      reservation: { ...reservation, cycleKey: ctx.cycle.key },
      released: false,
      createdBy: params.createdBy,
      createdAt: now,
      finishedAt: null,
    });
    return true;
  });

  return { batchId, created };
}

/* ------------------------------------------------------------- running */

function routerPort(config: RouterConfig): BatchRouter {
  return {
    find: async (username) => {
      const r = await findHotspotUser(config, username);
      return r.success
        ? { success: true, data: r.data ? { comment: r.data.comment, password: r.data.password } : null }
        : { success: false, error: r.error };
    },
    create: (user) => createHotspotUser(config, user),
  };
}

/**
 * Takes the batch's lease, if nobody holds a live one, and counts the
 * attempt. Null when it is finished or somebody else is running it.
 */
async function claimBatch(tenantId: string, batchId: string): Promise<VoucherBatch | null> {
  const ref = batchesRef(tenantId).doc(batchId);
  return adminDb.runTransaction(async (tx) => {
    const batch = parseBatch(await tx.get(ref));
    if (!batch || batch.state !== "minting") return null;
    const now = Date.now();
    if (batch.leaseUntil && batch.leaseUntil.getTime() > now) return null;
    const attempts = batch.attempts + 1;
    tx.update(ref, { leaseUntil: new Date(now + BATCH_LEASE_MS), attempts });
    return { ...batch, attempts };
  });
}

/**
 * Runs the batch if it needs running and nobody else is. Safe to call from
 * anywhere, any number of times; the losers of a race return null.
 */
export async function runBatchIfDue(
  tenantId: string,
  batchId: string
): Promise<BatchRunOutcome | null> {
  const batch = await claimBatch(tenantId, batchId);
  if (!batch) return null;

  const ref = batchesRef(tenantId).doc(batchId);
  const format = await getCodeFormat(tenantId);
  const taken = new Set(batch.codes.map((c) => c.username));

  return runBatch(batch, {
    now: () => new Date(),
    loadRouter: async () => {
      const doc = await adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).doc(batch.routerId).get();
      return doc.exists ? routerPort(routerConfigOf(doc.data()!)) : null;
    },
    indexUnused: async (usernames) => {
      await indexRef(tenantId, batch.routerId).set(
        {
          entries: FieldValue.arrayUnion(...usernames.map((u) => indexEntry(u, batchId))),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    },
    saveProgress: async (codes, patch) => {
      await ref.update({ codes: serialiseCodes(codes), ...patch });
    },
    release: async (failed) => {
      await releaseBatchQuota(tenantId, batchId, failed);
    },
    regenerate: () => {
      for (;;) {
        const c = generateCredential(format);
        if (!taken.has(c.username)) {
          taken.add(c.username);
          return c;
        }
      }
    },
  });
}

/** Gives back what failed codes cost, once, in the same transaction as the flag. */
async function releaseBatchQuota(tenantId: string, batchId: string, failed: number): Promise<void> {
  const ref = batchesRef(tenantId).doc(batchId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("released") === true) return;
    const reservation = snap.get("reservation") as VoucherBatch["reservation"];
    const back = releaseQuota(reservation, failed);

    if (back.fromAllowance > 0) {
      tx.set(
        adminDb.collection(TENANT_COLLECTIONS.generationUsage(tenantId)).doc(reservation.cycleKey),
        { used: FieldValue.increment(-back.fromAllowance), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }
    if (back.fromCredits > 0) {
      tx.set(
        creditsRef(tenantId),
        { balance: FieldValue.increment(back.fromCredits), updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.create(adminDb.collection(TENANT_COLLECTIONS.creditLedger(tenantId)).doc(), {
        meter: GENERATION_METER,
        delta: back.fromCredits,
        kind: "release",
        batchId,
        by: null,
        note: `${failed} code(s) could not be put on the router`,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    tx.update(ref, { released: true });
  });
}

/* ------------------------------------------------------- reading batches */

export interface BatchSummary {
  id: string;
  locationId: string;
  locationName: string;
  planName: string;
  count: number;
  state: VoucherBatch["state"];
  counts: Record<BatchCode["status"], number>;
  createdAt: string;
  createdByEmail: string | null;
}

function summarise(batch: VoucherBatch): BatchSummary {
  const counts: Record<BatchCode["status"], number> = {
    pending: 0,
    unused: 0,
    active: 0,
    void: 0,
    failed: 0,
  };
  for (const c of batch.codes) counts[c.status] += 1;
  return {
    id: batch.id,
    locationId: batch.locationId,
    locationName: batch.locationName,
    planName: batch.plan.name,
    count: batch.count,
    state: batch.state,
    counts,
    createdAt: batch.createdAt.toISOString(),
    createdByEmail: batch.createdBy?.email ?? null,
  };
}

export async function listBatches(tenantId: string, max = 50): Promise<BatchSummary[]> {
  const snap = await batchesRef(tenantId).orderBy("createdAt", "desc").limit(max).get();
  return snap.docs.map(parseBatch).filter((b): b is VoucherBatch => b !== null).map(summarise);
}

export interface BatchDetail extends BatchSummary {
  plan: VoucherBatch["plan"];
  codes: Array<{
    username: string;
    password: string;
    status: BatchCode["status"];
    error: string | null;
    activatedAt: string | null;
  }>;
}

export async function getBatch(tenantId: string, batchId: string): Promise<BatchDetail | null> {
  const batch = parseBatch(await batchesRef(tenantId).doc(batchId).get());
  if (!batch) return null;
  return {
    ...summarise(batch),
    plan: batch.plan,
    codes: batch.codes.map((c) => ({
      username: c.username,
      password: c.password,
      status: c.status,
      error: c.error,
      activatedAt: c.activatedAt?.toISOString() ?? null,
    })),
  };
}

/** Whether a batch is minting with a lapsed lease, i.e. a dead run to pick up. */
export function batchNeedsResume(batch: Pick<VoucherBatch, "state" | "leaseUntil">, now = new Date()): boolean {
  return batch.state === "minting" && (!batch.leaseUntil || batch.leaseUntil.getTime() <= now.getTime());
}

/* ------------------------------------------------------------ voiding */

/**
 * Withdraws unused codes: deletes each from the router, marks it void and
 * drops it from the index. A code somebody has already logged in with is
 * refused rather than voided - it is a live login by then, managed from the
 * Users page like any other. The quota is not given back: a code that was
 * printed may already have been handed out, and void-then-regenerate would
 * otherwise be a way to mint for free.
 *
 * Router first, then the record, one code at a time, so a router that stops
 * answering halfway leaves every code either still unused or truly void.
 */
export async function voidCodes(params: {
  tenantId: string;
  batchId: string;
  usernames: string[] | "all-unused";
}): Promise<{ voided: number; skipped: number; error: string | null }> {
  const { tenantId, batchId } = params;
  const ref = batchesRef(tenantId).doc(batchId);
  const batch = parseBatch(await ref.get());
  if (!batch) throw new GenerationError("Batch not found", 404, "not-found");
  if (batch.state === "minting") {
    throw new GenerationError("This batch is still being put on the router. Try again once it finishes.", 409, "in-use");
  }

  const wanted =
    params.usernames === "all-unused"
      ? batch.codes.filter((c) => c.status === "unused").map((c) => c.username)
      : params.usernames;
  const wantedSet = new Set(wanted);

  const routerDoc = await adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).doc(batch.routerId).get();
  const config = routerDoc.exists ? routerConfigOf(routerDoc.data()!) : null;

  const voided: string[] = [];
  let skipped = 0;
  let error: string | null = null;

  for (const code of batch.codes) {
    if (!wantedSet.has(code.username)) continue;
    if (code.status !== "unused") {
      skipped++;
      continue;
    }
    if (config) {
      const found = await findHotspotUser(config, code.username);
      if (!found.success) {
        error = found.error ?? "The router could not be reached";
        break;
      }
      if (found.data) {
        // Used since the cron last looked: the on-login script has replaced
        // our marker with an expiry. Leave it to activation.
        if ((found.data.comment ?? "").slice(0, 2).toLowerCase() !== "vc") {
          skipped++;
          continue;
        }
        const removed = await deleteHotspotUser(config, code.username);
        if (!removed.success) {
          error = removed.error ?? "The router refused to delete the code";
          break;
        }
      }
    }
    voided.push(code.username);
  }

  if (voided.length > 0) {
    const voidedSet = new Set(voided);
    await adminDb.runTransaction(async (tx) => {
      const fresh = parseBatch(await tx.get(ref));
      if (!fresh) return;
      const now = new Date();
      const codes = fresh.codes.map((c) =>
        voidedSet.has(c.username) && c.status === "unused" ? { ...c, status: "void" as const, voidedAt: now } : c
      );
      tx.update(ref, { codes: serialiseCodes(codes) });
      tx.set(
        indexRef(tenantId, batch.routerId),
        {
          entries: FieldValue.arrayRemove(...voided.map((u) => indexEntry(u, batchId))),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  return { voided: voided.length, skipped, error };
}

/* ---------------------------------------------------------- activation */

/**
 * Called by router-health with the router's user list it already fetched.
 * Turns every unused code somebody has logged in with into an ordinary
 * voucher document, and takes it out of the index. Returns how many.
 *
 * One read when the router has no unused codes (the index document), which
 * is every router of every tenant that never generated anything.
 */
export async function activateGeneratedCodes(
  tenantId: string,
  routerId: string,
  users: HotspotUser[],
  parseExpiry: (comment: string | undefined) => Date | null
): Promise<number> {
  const index = await readIndex(tenantId, routerId);
  if (Object.keys(index).length === 0) return 0;

  const found = findActivations(index, users, parseExpiry);
  if (found.length === 0) return 0;

  const byBatch = new Map<string, typeof found>();
  for (const a of found) {
    if (!byBatch.has(a.batchId)) byBatch.set(a.batchId, []);
    byBatch.get(a.batchId)!.push(a);
  }

  let activated = 0;
  for (const [batchId, items] of byBatch) {
    const ref = batchesRef(tenantId).doc(batchId);
    activated += await adminDb.runTransaction(async (tx) => {
      const batch = parseBatch(await tx.get(ref));
      const done: string[] = [];
      if (!batch) {
        // The batch is gone; the entries are stale. Drop them.
        tx.set(
          indexRef(tenantId, routerId),
          { entries: FieldValue.arrayRemove(...items.map((i) => indexEntry(i.username, batchId))) },
          { merge: true }
        );
        return 0;
      }

      const now = new Date();
      const expiryOf = new Map(items.map((i) => [i.username, i.expiresAt]));
      const codes = batch.codes.map((c) => {
        const expiresAt = expiryOf.get(c.username);
        if (!expiresAt || c.status !== "unused") return c;
        const voucherId = generatedVoucherId(batchId, c.username);
        // `set`, not `create`: inside a transaction a retry re-runs this
        // whole function, and the code's own status is what guards against
        // writing a second voucher - it is no longer "unused" afterwards.
        tx.set(adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).doc(voucherId), {
          source: "generated",
          batchId,
          generatedAt: batch.createdAt,
          userId: null,
          userEmail: null,
          planId: batch.plan.id,
          planName: batch.plan.name,
          locationId: batch.locationId,
          locationName: batch.locationName,
          tenantId,
          username: c.username,
          password: c.password,
          deviceMac: null,
          duration: batch.plan.duration,
          dataLimit: batch.plan.dataLimit || null,
          sharedUsers: batch.plan.sharedUsers || null,
          dataLimitBytes: parseDataLimitBytes(batch.plan.dataLimit),
          renewalOf: null,
          status: expiresAt.getTime() > now.getTime() ? "active" : "expired",
          paystackReference: "",
          retryCount: 0,
          // First use, which is when this credential entered circulation as
          // far as every count and list is concerned.
          createdAt: now,
          expiresAt,
        });
        done.push(c.username);
        return { ...c, status: "active" as const, voucherId, activatedAt: now };
      });

      // Entries for codes no longer unused (voided meanwhile, say) are
      // stale too, and are dropped with the rest.
      const drop = items.map((i) => i.username);
      tx.update(ref, { codes: serialiseCodes(codes) });
      tx.set(
        indexRef(tenantId, routerId),
        {
          entries: FieldValue.arrayRemove(...drop.map((u) => indexEntry(u, batchId))),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return done.length;
    });
  }
  return activated;
}

/** Batches on this router whose run died, for router-health to finish. */
export async function resumeStalledBatches(tenantId: string, routerId: string): Promise<number> {
  // Equality on state only, routerId filtered in memory: a second equality
  // would want a composite index for a handful of documents.
  const snap = await batchesRef(tenantId).where("state", "==", "minting").limit(20).get();
  let resumed = 0;
  for (const doc of snap.docs) {
    const batch = parseBatch(doc);
    if (!batch || batch.routerId !== routerId || !batchNeedsResume(batch)) continue;
    if (await runBatchIfDue(tenantId, batch.id)) resumed++;
  }
  return resumed;
}

/* ------------------------------------------------------------- credits */

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  kind: "grant" | "consume" | "release" | "deduct";
  batchId: string | null;
  note: string | null;
  byEmail: string | null;
  createdAt: string;
}

/**
 * A superadmin changes a tenant's credit balance: a grant after a bank
 * transfer while online payments are down, a goodwill top-up, or a
 * correction. Later, the payment service posts a grant with a provider
 * reference here, and nothing else changes. A balance may not go negative.
 */
export async function adjustCredits(params: {
  tenantId: string;
  delta: number;
  note: string;
  by: { uid: string; email: string | null };
}): Promise<number> {
  const { tenantId, delta } = params;
  if (!Number.isInteger(delta) || delta === 0) throw new GenerationError("Enter a whole number of credits.");
  const ref = creditsRef(tenantId);
  return adminDb.runTransaction(async (tx) => {
    const tenant = await tx.get(adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId));
    if (!tenant.exists) throw new GenerationError("Tenant not found", 404, "not-found");
    const balance = Number((await tx.get(ref)).get("balance") ?? 0);
    const next = balance + delta;
    if (next < 0) {
      throw new GenerationError(`That would leave ${next} credits. The balance is ${balance}.`);
    }
    tx.set(ref, { balance: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.create(adminDb.collection(TENANT_COLLECTIONS.creditLedger(tenantId)).doc(), {
      meter: GENERATION_METER,
      delta,
      kind: delta > 0 ? "grant" : "deduct",
      batchId: null,
      by: params.by,
      note: params.note,
      source: { kind: "manual" },
      createdAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
}

export async function listCreditLedger(tenantId: string, max = 50): Promise<CreditLedgerEntry[]> {
  const snap = await adminDb
    .collection(TENANT_COLLECTIONS.creditLedger(tenantId))
    .orderBy("createdAt", "desc")
    .limit(max)
    .get();
  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      delta: Number(d.delta ?? 0),
      kind: d.kind,
      batchId: d.batchId ?? null,
      note: d.note ?? null,
      byEmail: d.by?.email ?? null,
      createdAt: (toDate(d.createdAt) ?? new Date(0)).toISOString(),
    };
  });
}
