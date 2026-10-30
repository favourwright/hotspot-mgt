/**
 * The decision-hook contract and the circuit breaker, as pure code.
 *
 * Kept free of Firestore and network so `npm run test:decision-hooks`
 * covers every rule directly. lib/decision-hooks.ts does the I/O.
 *
 * ## The contract, from the tenant's side
 *
 * We POST a signed JSON event. They answer with a 2xx and exactly one of
 *
 *   { "allowed": true }
 *   { "allowed": false, "reason": "Shown to the customer", "code": "AGE_RESTRICTION" }
 *
 * plus, on a block, an optional `"requireLink": true` meaning "I don't know
 * this customer yet": the checkout then offers to verify them with the
 * tenant (account linking, lib/hook-links.ts).
 *
 * Anything else is a failure, and the hook's own fail strategy decides:
 * a non-2xx (even one carrying `allowed: true`), a body that is not JSON,
 * `allowed` that is not strictly the boolean true or false (the string
 * "false" is truthy, which is exactly the bug a loose check would ship).
 *
 * The response cannot change the price, the split or anything else. A
 * tenant whose server could lower the price would be lowering the
 * platform's commission with it.
 */

import { z } from "zod";

/** Bumped only for a breaking change; fields are added within a version. */
export const HOOK_API_VERSION = "2026-10-29";

export const HOOK_EVENT = "voucher.pre_purchase";

export type FailStrategy = "block" | "allow";

/** The hard ceiling on a hook's own timeout setting. */
export const MAX_HOOK_TIMEOUT_MS = 2500;
export const DEFAULT_HOOK_TIMEOUT_MS = 2000;
export const MAX_HOOK_RESPONSE_BYTES = 10 * 1024;

const MAX_REASON = 200;

/** What the customer sees when a block hook cannot be reached. */
export const UNAVAILABLE_REASON =
  "We couldn't confirm you can buy this right now. Please try again in a few minutes.";

/** What the customer sees when a hook blocks with no usable reason. */
export const DEFAULT_BLOCK_REASON = "This purchase isn't available for your account.";

export type HookVerdict =
  | { kind: "allow" }
  | { kind: "block"; reason: string; code: string | null; requireLink: boolean }
  | { kind: "invalid"; error: string };

export function parseHookResponse(status: number, body: string): HookVerdict {
  if (status < 200 || status >= 300) {
    return { kind: "invalid", error: `HTTP ${status}` };
  }

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { kind: "invalid", error: "Response was not JSON" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { kind: "invalid", error: "Response was not a JSON object" };
  }

  const allowed = (data as { allowed?: unknown }).allowed;
  if (allowed === true) return { kind: "allow" };
  if (allowed !== false) {
    return { kind: "invalid", error: '"allowed" must be true or false' };
  }

  return {
    kind: "block",
    reason: sanitizeReason((data as { reason?: unknown }).reason),
    code: sanitizeCode((data as { code?: unknown }).code),
    // "We don't know who this is yet": the checkout offers to verify the
    // customer with the tenant (lib/hook-links.ts). Strictly true, like
    // `allowed`, and only meaningful on a block.
    requireLink: (data as { requireLink?: unknown }).requireLink === true,
  };
}

/**
 * Tenant-written text shown to a customer: plain text only, one line,
 * capped. Rendered by React as text, never as HTML; this is about length
 * and noise, not escaping.
 */
export function sanitizeReason(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_BLOCK_REASON;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return DEFAULT_BLOCK_REASON;
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 3).trimEnd()}...` : text;
}

/** Machine-readable, for the tenant's own logs. Dropped unless tidy. */
export function sanitizeCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9_]{1,64}$/.test(value) ? value : null;
}

/** Whether a hook covers this purchase. Null filter = everything. */
export function hookApplies(
  hook: { planIds: string[] | null; locationIds: string[] | null },
  planId: string,
  locationId: string
): boolean {
  if (hook.planIds && hook.planIds.length > 0 && !hook.planIds.includes(planId)) return false;
  if (hook.locationIds && hook.locationIds.length > 0 && !hook.locationIds.includes(locationId)) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------- breaker */

export const BREAKER_THRESHOLD = 10;
/** Failures older than this stop counting towards a trip. */
export const BREAKER_FAILURE_WINDOW_MS = 5 * 60 * 1000;
/** While open, how often one request is let through to test the hook. */
export const BREAKER_PROBE_INTERVAL_MS = 30 * 1000;

interface BreakerEntry {
  failures: number;
  lastFailureAt: number;
  open: boolean;
  lastProbeAt: number;
  probing: boolean;
}

/**
 * Per hook: stop calling a server that keeps failing, and keep checking
 * whether it has come back.
 *
 * Tripping does **not** turn the hook off. While open, every purchase gets
 * the hook's fail strategy without the network call: a `block` hook keeps
 * blocking (sales paused, which is what the tenant chose), an `allow` hook
 * keeps allowing. One request every 30 seconds is let through as a probe,
 * one at a time, and a successful probe closes the breaker.
 *
 * Held in memory, like every limiter in this app (one long-lived process).
 * A restart closes every breaker, and the next ten failures re-open it.
 * The alert emails are stamped in Firestore, so a restart does not resend
 * them. Bounded: entries for hooks nobody calls are dropped oldest first.
 */
export class CircuitBreaker {
  private entries = new Map<string, BreakerEntry>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 5000
  ) {}

  /** Whether to make the call: normally, as the probe, or not at all. */
  before(hookId: string): "call" | "probe" | "open" {
    const e = this.entries.get(hookId);
    if (!e || !e.open) return "call";
    const t = this.now();
    if (!e.probing && t - e.lastProbeAt >= BREAKER_PROBE_INTERVAL_MS) {
      e.probing = true;
      e.lastProbeAt = t;
      return "probe";
    }
    return "open";
  }

  /** A valid answer, `allowed: false` included. Returns true if it just closed. */
  recordSuccess(hookId: string): boolean {
    const e = this.entries.get(hookId);
    if (!e) return false;
    const wasOpen = e.open;
    this.entries.delete(hookId);
    return wasOpen;
  }

  /** Returns true if this failure just tripped the breaker. */
  recordFailure(hookId: string): boolean {
    const t = this.now();
    let e = this.entries.get(hookId);
    if (!e) {
      e = { failures: 0, lastFailureAt: 0, open: false, lastProbeAt: 0, probing: false };
    }
    // "Consecutive" in practice: failures spread over days never add up.
    if (!e.open && t - e.lastFailureAt > BREAKER_FAILURE_WINDOW_MS) e.failures = 0;
    e.failures += 1;
    e.lastFailureAt = t;
    e.probing = false;

    let tripped = false;
    if (!e.open && e.failures >= BREAKER_THRESHOLD) {
      e.open = true;
      e.lastProbeAt = t;
      tripped = true;
    }

    // Re-inserted so the map's first key is the least recently touched.
    this.entries.delete(hookId);
    this.entries.set(hookId, e);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return tripped;
  }

  /** For the hooks page: what a tenant needs to see. */
  state(hookId: string): { open: boolean; failures: number } {
    const e = this.entries.get(hookId);
    return { open: e?.open ?? false, failures: e?.failures ?? 0 };
  }

  /** An owner edited or re-enabled the hook: give it a clean start. */
  reset(hookId: string): void {
    this.entries.delete(hookId);
  }
}

/* ------------------------------------------------------- published shapes */

/**
 * What we send a decision hook and what it may answer, as schemas, for the
 * generated docs (lib/openapi.ts). `npm run test:decision-hooks` parses the
 * real request body with these, strictly, so the docs cannot describe a
 * payload the code does not send.
 */
export const DecisionHookRequestSchema = z
  .strictObject({
    apiVersion: z.string(),
    id: z.string().describe("Unique per call; also sent as `ogawifi-request-id`"),
    event: z.literal(HOOK_EVENT),
    createdAt: z.string().describe("ISO 8601 time, UTC"),
    test: z.literal(true).optional().describe("Present only on calls from the Send test button"),
    data: z.strictObject({
      customer: z.strictObject({
        uid: z.string().describe("Our id for this customer; never changes"),
        email: z.string().describe("Proves nothing unless emailVerified is true"),
        emailVerified: z.boolean().describe("They confirmed they control this inbox"),
        externalId: z
          .string()
          .nullable()
          .describe("Your own id for this customer, once you have verified them through account linking"),
      }),
      plan: z.strictObject({ id: z.string(), name: z.string(), priceKobo: z.number().int() }),
      location: z.strictObject({ id: z.string(), name: z.string() }),
      purchase: z.strictObject({
        intent: z.enum(["reuse", "fresh"]).describe("reuse: topping up a login they have; fresh: a new code"),
      }),
    }),
  })
  .meta({ id: "DecisionHookRequest", description: "The signed body POSTed to a decision hook" });

export const DecisionHookResponseSchema = z
  .union([
    z.object({ allowed: z.literal(true) }),
    z.object({
      allowed: z.literal(false),
      reason: z.string().max(200).optional().describe("Shown to the customer as plain text"),
      code: z.string().regex(/^[A-Z0-9_]{1,64}$/).optional().describe("For your own logs"),
      requireLink: z.literal(true).optional().describe("You don't know this customer yet: offer to verify them"),
    }),
  ])
  .meta({ id: "DecisionHookResponse", description: "A 2xx with exactly one of these; anything else counts as a failure" });

