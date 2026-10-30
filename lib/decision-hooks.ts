/**
 * Decision hooks: a tenant's own server, asked before a purchase whether
 * this customer may buy.
 *
 * Runs inside /api/purchase/initiate, after the platform's own eligibility
 * checks and **before** the pending record and the Paystack transaction
 * exist. A blocked purchase therefore never charges anybody, so no refund
 * is ever needed. That ordering is the whole design: run anywhere later and
 * a "no" arrives after the money has moved.
 *
 * One hook per tenant for `voucher.pre_purchase` in this version, optionally
 * narrowed to some plans or locations. The contract and the breaker are in
 * lib/decision-hook-contract.ts; the network guard in lib/safe-fetch.ts;
 * signing in lib/hook-signing.ts. docs/decision-hooks.md is what tenants
 * read.
 *
 * ## What a failure does
 *
 * A timeout, an error, a malformed answer, the per-tenant cap, or an open
 * breaker all mean the same thing: apply the hook's fail strategy, which
 * the owner chose when they created it. `block` pauses sales (an age check
 * that turns itself off when the tenant's server is down would defeat the
 * point); `allow` lets the sale through. Nothing ever silently switches a
 * hook off.
 */

import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { createDocCache } from "@/lib/doc-cache";
import { rateLimit } from "@/lib/rate-limit";
import { safeFetch, SafeFetchError, type SafeFetchResponse, type SafeFetchOptions } from "@/lib/safe-fetch";
import { SIGNATURE_HEADER, signatureHeader } from "@/lib/hook-signing";
import { decryptHookSecret } from "@/lib/hook-secrets";
import {
  CircuitBreaker,
  DEFAULT_HOOK_TIMEOUT_MS,
  HOOK_API_VERSION,
  HOOK_EVENT,
  MAX_HOOK_RESPONSE_BYTES,
  MAX_HOOK_TIMEOUT_MS,
  UNAVAILABLE_REASON,
  hookApplies,
  parseHookResponse,
  type FailStrategy,
} from "@/lib/decision-hook-contract";
import { notifyHookFailing, notifyHookRecovered } from "@/lib/notifications";
import { getExternalId } from "@/lib/hook-links";

export interface DecisionHook {
  id: string;
  tenantId: string;
  name: string;
  event: typeof HOOK_EVENT;
  url: string;
  /**
   * The tenant's own "verify this customer" page, for account linking
   * (lib/hook-links.ts). Optional: without it, `requireLink` from the hook
   * is just a block.
   */
  linkUrl: string | null;
  /**
   * Whether the verification page's host made it into the walled garden of
   * every router with the portal installed (lib/hook-walled-garden.ts).
   */
  walledGardenSync: { at: string; host: string | null; synced: number; failed: string[] } | null;
  secretCiphertext: string;
  secretKeyVersion: number;
  /** Still signed with during a rotation, until `previousSecretExpiresAt`. */
  previousSecretCiphertext: string | null;
  previousSecretKeyVersion: number | null;
  previousSecretExpiresAt: Date | null;
  timeoutMs: number;
  failStrategy: FailStrategy;
  planIds: string[] | null;
  locationIds: string[] | null;
  active: boolean;
  /** Set when the "hook is failing" email went out; cleared on recovery. */
  breakerAlertedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  createdBy: string;
}

/** A hook as the owner's page sees it: no secret material at all. */
export interface DecisionHookView {
  id: string;
  name: string;
  url: string;
  linkUrl: string | null;
  walledGardenSync: DecisionHook["walledGardenSync"];
  timeoutMs: number;
  failStrategy: FailStrategy;
  planIds: string[] | null;
  locationIds: string[] | null;
  active: boolean;
  rotating: boolean;
  breaker: { open: boolean; failures: number };
  createdAt: string | null;
  updatedAt: string | null;
}

export type HookOutcome =
  | "allowed"
  | "blocked"
  | "failed"
  | "breaker_open"
  | "rate_capped"
  | "test";

export type HookDecision =
  | {
      allowed: true;
      hookId: string | null;
      requestId: string | null;
      outcome: HookOutcome | "no_hook" | "cached";
    }
  | {
      allowed: false;
      reason: string;
      code: string | null;
      hookId: string;
      requestId: string;
      outcome: HookOutcome;
      /**
       * The hook asked for the customer to be verified, and it has a
       * verification page to send them to. The checkout offers the button.
       */
      canLink?: boolean;
    };

export interface PurchaseContext {
  tenantId: string;
  /**
   * `emailVerified` is false for most customers today (signup does not
   * verify), and says so to the hook so it never treats an email as proof.
   */
  customer: { uid: string; email: string; emailVerified: boolean };
  plan: { id: string; name: string; priceKobo: number };
  location: { id: string; name: string };
  intent: "reuse" | "fresh";
}

/* ------------------------------------------------ in-process state */

export const breaker = new CircuitBreaker();

/**
 * Generous on purpose: this caps calls to the tenant's server, not their
 * sales. It should only ever trip under abuse. Over the cap, the hook's own
 * fail strategy applies, so flooding cannot be used to slip past a block.
 */
const TENANT_CALL_CAP = { max: 600, windowMs: 60_000 };

/**
 * An "allowed" answer is reused for a few seconds per buyer, plan and
 * location, so a double tap does not call the tenant twice. Blocks are not
 * cached: the tenant may fix the customer's record and they retry at once.
 */
const ALLOW_CACHE_MS = 10_000;
const allowCache = new Map<string, number>();

const hooksCache = createDocCache<DecisionHook[]>(60_000);

/* ------------------------------------------------ storage */

export async function listTenantHooks(tenantId: string): Promise<DecisionHook[]> {
  return hooksCache.get(tenantId, async () => {
    const snap = await adminDb.collection(TENANT_COLLECTIONS.hooks(tenantId)).limit(20).get();
    return snap.docs.map((d) => hookFromData(d.id, tenantId, d.data()));
  });
}

/** Every route that writes a hook calls this, per lib/doc-cache.ts. */
export function invalidateTenantHooks(tenantId: string): void {
  hooksCache.invalidate(tenantId);
}

export function hookFromData(
  id: string,
  tenantId: string,
  d: FirebaseFirestore.DocumentData
): DecisionHook {
  return {
    id,
    tenantId,
    name: d.name ?? "",
    event: HOOK_EVENT,
    url: d.url ?? "",
    linkUrl: typeof d.linkUrl === "string" && d.linkUrl ? d.linkUrl : null,
    walledGardenSync:
      d.walledGardenSync && typeof d.walledGardenSync === "object"
        ? {
            at: String(d.walledGardenSync.at ?? ""),
            host: d.walledGardenSync.host ?? null,
            synced: Number(d.walledGardenSync.synced ?? 0),
            failed: Array.isArray(d.walledGardenSync.failed) ? d.walledGardenSync.failed : [],
          }
        : null,
    secretCiphertext: d.secretCiphertext ?? "",
    secretKeyVersion: d.secretKeyVersion ?? 1,
    previousSecretCiphertext: d.previousSecretCiphertext ?? null,
    previousSecretKeyVersion: d.previousSecretKeyVersion ?? null,
    previousSecretExpiresAt: toDate(d.previousSecretExpiresAt),
    timeoutMs: clampTimeout(d.timeoutMs),
    failStrategy: d.failStrategy === "allow" ? "allow" : "block",
    planIds: Array.isArray(d.planIds) ? d.planIds : null,
    locationIds: Array.isArray(d.locationIds) ? d.locationIds : null,
    active: d.active === true,
    breakerAlertedAt: toDate(d.breakerAlertedAt),
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
    createdBy: d.createdBy ?? "",
  };
}

export function hookView(hook: DecisionHook): DecisionHookView {
  return {
    id: hook.id,
    name: hook.name,
    url: hook.url,
    linkUrl: hook.linkUrl,
    walledGardenSync: hook.walledGardenSync,
    timeoutMs: hook.timeoutMs,
    failStrategy: hook.failStrategy,
    planIds: hook.planIds,
    locationIds: hook.locationIds,
    active: hook.active,
    rotating: isRotating(hook, Date.now()),
    breaker: breaker.state(hook.id),
    createdAt: hook.createdAt?.toISOString() ?? null,
    updatedAt: hook.updatedAt?.toISOString() ?? null,
  };
}

export function clampTimeout(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_HOOK_TIMEOUT_MS;
  return Math.min(MAX_HOOK_TIMEOUT_MS, Math.max(500, n));
}

/* ------------------------------------------------ the call */

export interface HookDeps {
  loadHooks: (tenantId: string) => Promise<DecisionHook[]>;
  /** The tenant's own id for this customer, from account linking. */
  loadExternalId: (tenantId: string, uid: string) => Promise<string | null>;
  fetch: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResponse>;
  now: () => number;
  /** Work that must not delay the purchase: logs and alerts. */
  defer: (task: () => Promise<void>) => void;
  log: (entry: HookCallLog) => Promise<void>;
  alertFailing: (hook: DecisionHook, lastError: string) => Promise<void>;
  alertRecovered: (hook: DecisionHook) => Promise<void>;
}

export const productionHookDeps: HookDeps = {
  loadHooks: listTenantHooks,
  loadExternalId: getExternalId,
  fetch: safeFetch,
  now: Date.now,
  // Next runs these after the response is sent. The app is one long-lived
  // process, so they do run; a restart in the gap loses a log line, which
  // is acceptable for logs and nothing else uses this.
  defer: (task) =>
    after(() =>
      task().catch((error) => console.error("[hooks] deferred task failed:", error))
    ),
  log: writeHookCall,
  alertFailing: alertBreakerTripped,
  alertRecovered: alertBreakerClosed,
};

/**
 * Asks the tenant's hook, if one covers this purchase. Never throws: every
 * failure resolves to the hook's fail strategy.
 */
export async function runPrePurchaseHook(
  ctx: PurchaseContext,
  deps: HookDeps = productionHookDeps
): Promise<HookDecision> {
  let hooks: DecisionHook[];
  try {
    hooks = await deps.loadHooks(ctx.tenantId);
  } catch (error) {
    // Could not even read the configuration. There may be a block hook we
    // cannot see, and selling past it is the worse mistake.
    console.error(`[hooks] could not load hooks for ${ctx.tenantId}:`, error);
    return {
      allowed: false,
      reason: UNAVAILABLE_REASON,
      code: "HOOK_UNAVAILABLE",
      hookId: "unknown",
      requestId: "none",
      outcome: "failed",
    };
  }

  const hook = hooks.find(
    (h) => h.active && h.event === HOOK_EVENT && hookApplies(h, ctx.plan.id, ctx.location.id)
  );
  if (!hook) return { allowed: true, hookId: null, requestId: null, outcome: "no_hook" };

  const now = deps.now();
  const cacheKey = `${ctx.tenantId}:${hook.id}:${ctx.customer.uid}:${ctx.plan.id}:${ctx.location.id}`;
  const cachedUntil = allowCache.get(cacheKey);
  if (cachedUntil && cachedUntil > now) {
    return { allowed: true, hookId: hook.id, requestId: null, outcome: "cached" };
  }

  const requestId = `req_${randomBytes(8).toString("hex")}`;
  const started = now;

  const finish = (
    outcome: HookOutcome,
    extra: { httpStatus?: number | null; error?: string | null; reason?: string | null; code?: string | null } = {}
  ) => {
    deps.defer(() =>
      deps.log({
        tenantId: ctx.tenantId,
        hookId: hook.id,
        requestId,
        outcome,
        httpStatus: extra.httpStatus ?? null,
        latencyMs: deps.now() - started,
        error: extra.error ?? null,
        reason: extra.reason ?? null,
        code: extra.code ?? null,
        uid: ctx.customer.uid,
        planId: ctx.plan.id,
        locationId: ctx.location.id,
      })
    );
  };

  const failOpenOrClosed = (
    outcome: HookOutcome,
    error: string,
    httpStatus: number | null = null
  ): HookDecision => {
    finish(outcome, { error, httpStatus });
    if (hook.failStrategy === "allow") {
      return { allowed: true, hookId: hook.id, requestId, outcome };
    }
    return {
      allowed: false,
      reason: UNAVAILABLE_REASON,
      code: "HOOK_UNAVAILABLE",
      hookId: hook.id,
      requestId,
      outcome,
    };
  };

  if (!rateLimit(`hookcalls:${ctx.tenantId}`, TENANT_CALL_CAP, now).ok) {
    return failOpenOrClosed("rate_capped", "Per-tenant hook call cap reached");
  }

  if (breaker.before(hook.id) === "open") {
    return failOpenOrClosed("breaker_open", "Hook is failing repeatedly; not called");
  }

  const result = await callHook(hook, ctx, requestId, false, deps);

  if (result.verdict.kind === "invalid") {
    const error = result.verdict.error;
    if (breaker.recordFailure(hook.id)) deps.defer(() => deps.alertFailing(hook, error));
    return failOpenOrClosed("failed", error, result.status);
  }

  // A valid answer either way, `allowed: false` included.
  if (breaker.recordSuccess(hook.id)) deps.defer(() => deps.alertRecovered(hook));

  if (result.verdict.kind === "block") {
    finish("blocked", { httpStatus: result.status, reason: result.verdict.reason, code: result.verdict.code });
    return {
      allowed: false,
      reason: result.verdict.reason,
      code: result.verdict.code,
      hookId: hook.id,
      requestId,
      outcome: "blocked",
      canLink: result.verdict.requireLink && hook.linkUrl !== null,
    };
  }

  allowCache.set(cacheKey, now + ALLOW_CACHE_MS);
  while (allowCache.size > 10_000) {
    const oldest = allowCache.keys().next().value;
    if (oldest === undefined) break;
    allowCache.delete(oldest);
  }
  finish("allowed", { httpStatus: result.status });
  return { allowed: true, hookId: hook.id, requestId, outcome: "allowed" };
}

/**
 * The owner's Test button: a real, signed call with sample data marked
 * `test: true`, through exactly the same guard. Never touches the breaker,
 * because a tenant debugging their server should not trip their own sales.
 */
export async function testHook(
  hook: DecisionHook,
  ctx: PurchaseContext,
  deps: HookDeps = productionHookDeps
) {
  const requestId = `req_${randomBytes(8).toString("hex")}`;
  const started = deps.now();
  const result = await callHook(hook, ctx, requestId, true, deps);
  const latencyMs = deps.now() - started;
  await deps.log({
    tenantId: hook.tenantId,
    hookId: hook.id,
    requestId,
    outcome: "test",
    httpStatus: result.status,
    latencyMs,
    error: result.verdict.kind === "invalid" ? result.verdict.error : null,
    reason: result.verdict.kind === "block" ? result.verdict.reason : null,
    code: result.verdict.kind === "block" ? result.verdict.code : null,
    uid: ctx.customer.uid,
    planId: ctx.plan.id,
    locationId: ctx.location.id,
  });
  return { requestId, latencyMs, ...result };
}

async function callHook(
  hook: DecisionHook,
  ctx: PurchaseContext,
  requestId: string,
  test: boolean,
  deps: HookDeps
): Promise<{
  status: number | null;
  verdict: ReturnType<typeof parseHookResponse>;
  bodyPreview: string | null;
}> {
  let secrets: string[];
  try {
    secrets = signingSecrets(hook, deps.now());
  } catch {
    return { status: null, verdict: { kind: "invalid", error: "Signing secret unavailable on this server" }, bodyPreview: null };
  }

  // Read per call, never cached: a customer who has just verified must be
  // recognised on the very next attempt. A failed read sends null rather
  // than failing the call; the hook then treats them as unlinked.
  let externalId: string | null = null;
  try {
    externalId = await deps.loadExternalId(hook.tenantId, ctx.customer.uid);
  } catch (error) {
    console.error(`[hooks] could not read customer link for ${ctx.customer.uid}:`, error);
  }

  const nowMs = deps.now();
  const timestamp = Math.floor(nowMs / 1000);
  // Stringified once: the bytes signed are the bytes sent.
  const body = JSON.stringify({
    apiVersion: HOOK_API_VERSION,
    id: requestId,
    event: HOOK_EVENT,
    createdAt: new Date(nowMs).toISOString(),
    ...(test ? { test: true } : {}),
    data: {
      customer: {
        uid: ctx.customer.uid,
        email: ctx.customer.email,
        emailVerified: ctx.customer.emailVerified,
        externalId,
      },
      plan: { id: ctx.plan.id, name: ctx.plan.name, priceKobo: ctx.plan.priceKobo },
      location: { id: ctx.location.id, name: ctx.location.name },
      purchase: { intent: ctx.intent },
    },
  });

  try {
    const response = await deps.fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "OgaWiFi-Hooks/1",
        "ogawifi-event": HOOK_EVENT,
        "ogawifi-request-id": requestId,
        [SIGNATURE_HEADER.toLowerCase()]: signatureHeader(secrets, timestamp, body),
      },
      body,
      timeoutMs: clampTimeout(hook.timeoutMs),
      maxBytes: MAX_HOOK_RESPONSE_BYTES,
    });
    return {
      status: response.status,
      verdict: parseHookResponse(response.status, response.body),
      bodyPreview: response.body.slice(0, 2000),
    };
  } catch (error) {
    const message =
      error instanceof SafeFetchError
        ? error.kind === "timeout"
          ? "Timed out"
          : error.message
        : "Request failed";
    return { status: null, verdict: { kind: "invalid", error: message }, bodyPreview: null };
  }
}

function isRotating(hook: DecisionHook, nowMs: number): boolean {
  return Boolean(
    hook.previousSecretCiphertext &&
      hook.previousSecretExpiresAt &&
      hook.previousSecretExpiresAt.getTime() > nowMs
  );
}

function signingSecrets(hook: DecisionHook, nowMs: number): string[] {
  const secrets = [decryptHookSecret(hook.secretCiphertext, hook.secretKeyVersion)];
  if (isRotating(hook, nowMs) && hook.previousSecretCiphertext) {
    secrets.push(
      decryptHookSecret(hook.previousSecretCiphertext, hook.previousSecretKeyVersion ?? 1)
    );
  }
  return secrets;
}

/* ------------------------------------------------ logs and alerts */

export interface HookCallLog {
  tenantId: string;
  hookId: string;
  requestId: string;
  outcome: HookOutcome;
  httpStatus: number | null;
  latencyMs: number;
  error: string | null;
  reason: string | null;
  code: string | null;
  uid: string;
  planId: string;
  locationId: string;
}

const CALL_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function writeHookCall(entry: HookCallLog): Promise<void> {
  await adminDb.collection(COLLECTIONS.HOOK_CALLS).add({
    ...entry,
    error: entry.error?.slice(0, 300) ?? null,
    createdAt: FieldValue.serverTimestamp(),
    deleteAt: new Date(Date.now() + CALL_LOG_RETENTION_MS),
  });
}

/**
 * Emailed once per trip, not once per failure and not once per restart:
 * the stamp is in Firestore and the email goes only on the transition.
 */
async function alertBreakerTripped(hook: DecisionHook, lastError: string): Promise<void> {
  const ref = adminDb.collection(TENANT_COLLECTIONS.hooks(hook.tenantId)).doc(hook.id);
  const first = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.breakerAlertedAt) return false;
    tx.update(ref, { breakerAlertedAt: FieldValue.serverTimestamp() });
    return true;
  });
  invalidateTenantHooks(hook.tenantId);
  if (first) await notifyHookFailing({ tenantId: hook.tenantId, hookName: hook.name, failStrategy: hook.failStrategy, lastError });
}

async function alertBreakerClosed(hook: DecisionHook): Promise<void> {
  const ref = adminDb.collection(TENANT_COLLECTIONS.hooks(hook.tenantId)).doc(hook.id);
  const wasAlerted = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || !snap.data()?.breakerAlertedAt) return false;
    tx.update(ref, { breakerAlertedAt: null });
    return true;
  });
  invalidateTenantHooks(hook.tenantId);
  if (wasAlerted) await notifyHookRecovered({ tenantId: hook.tenantId, hookName: hook.name });
}

export async function listHookCalls(hookId: string, limit = 50) {
  const snap = await adminDb
    .collection(COLLECTIONS.HOOK_CALLS)
    .where("hookId", "==", hookId)
    .orderBy("createdAt", "desc")
    .limit(Math.min(limit, 100))
    .get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      requestId: data.requestId as string,
      outcome: data.outcome as HookOutcome,
      httpStatus: (data.httpStatus as number | null) ?? null,
      latencyMs: (data.latencyMs as number) ?? 0,
      error: (data.error as string | null) ?? null,
      reason: (data.reason as string | null) ?? null,
      createdAt: toDate(data.createdAt)?.toISOString() ?? null,
    };
  });
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}
