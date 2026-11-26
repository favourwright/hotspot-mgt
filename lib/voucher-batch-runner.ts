/**
 * Puts a batch of generated codes onto the router, resumably.
 *
 * The same discipline as lib/fulfilment-runner.ts, which is the reference
 * and worth reading first: decide everything before touching the router
 * (the codes, with their passwords, are written into the batch document
 * when it is created), then carry it out step by step, recording each step,
 * so whoever runs next - the request that created it, the owner's page
 * polling it, or the router-health cron - can finish what a dead process
 * started without doing anything twice.
 *
 * Deliberately not the fulfilment ledger itself. That one carries payment
 * rules (the payment document is written last, auto-login, receipts) that
 * mean nothing here, and a generated code has no buyer to email.
 *
 * No Firestore and no router in this file: `npm run test:voucher-generation`
 * stops it after every step and proves a resume ends with each code on the
 * router once, in the index once, and the quota for failures given back once.
 */

import type { GeneratedCredential, Reservation } from "@/lib/voucher-generation-rules";

export const BATCH_LEASE_MS = 3 * 60 * 1000;

/** How many codes go to the router between progress writes. */
export const BATCH_CHUNK_SIZE = 10;

/**
 * Runs after which the remaining codes are given up on. A router that is
 * offline for good would otherwise hold the batch, and its quota, forever.
 */
export const MAX_BATCH_ATTEMPTS = 6;

/** How many fresh names a code gets if its first one is taken on the router. */
const MAX_RENAMES = 3;

/**
 * - `pending`: decided, not yet confirmed on the router.
 * - `unused`: on the router, nobody has logged in with it.
 * - `active`: somebody logged in; a voucher document now exists for it.
 * - `void`: the owner withdrew it before use; deleted from the router.
 * - `failed`: never made it onto the router; its quota was given back.
 */
export type BatchCodeStatus = "pending" | "unused" | "active" | "void" | "failed";

export interface BatchCode {
  username: string;
  password: string;
  status: BatchCodeStatus;
  error: string | null;
  /** The voucher document written on first use. */
  voucherId: string | null;
  activatedAt: Date | null;
  voidedAt: Date | null;
}

export interface BatchPlanSnapshot {
  id: string;
  name: string;
  /**
   * The plan's price in kobo when the batch was generated, which is what each
   * card is sold for. Copied onto the voucher at first use as `cashSaleKobo`,
   * so a later price change cannot rewrite what was earned. Null on batches
   * from before it was recorded, until `scripts/backfill-cash-sales.mts`
   * fills it in from the plan's price at the time of the backfill.
   */
  priceKobo: number | null;
  duration: string;
  dataLimit: string | null;
  sharedUsers: string | null;
  mikrotikProfile: string;
  routerDurationValue: number | null;
  routerDurationUnit: "h" | "d" | null;
}

export type BatchState = "minting" | "ready" | "partial" | "failed";

export interface VoucherBatch {
  id: string;
  tenantId: string;
  locationId: string;
  locationName: string;
  routerId: string;
  plan: BatchPlanSnapshot;
  count: number;
  codes: BatchCode[];
  state: BatchState;
  leaseUntil: Date | null;
  attempts: number;
  /** What this batch cost, and which cycle's allowance it drew on. */
  reservation: Reservation & { cycleKey: string };
  /** Quota for failed codes has been given back. Exactly once. */
  released: boolean;
  createdBy: { uid: string; email: string | null };
  createdAt: Date;
  finishedAt: Date | null;
}

interface RouterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface BatchRouter {
  find(username: string): Promise<RouterResult<{ comment?: string; password?: string } | null>>;
  create(user: {
    username: string;
    password: string;
    profile: string;
    comment: string;
    dataLimit: string | null;
  }): Promise<RouterResult>;
}

export interface BatchRunnerDeps {
  /** Null when the router document no longer exists. */
  loadRouter(): Promise<BatchRouter | null>;
  /**
   * Adds these usernames to the router's unused-code index. Idempotent.
   * Always called before the codes are recorded as `unused`, so a code the
   * batch calls unused is always one the activation sweep is watching.
   */
  indexUnused(usernames: string[]): Promise<void>;
  /** Writes the codes array, and the batch fields given, onto the batch document. */
  saveProgress(
    codes: BatchCode[],
    patch: Partial<Pick<VoucherBatch, "state" | "finishedAt" | "leaseUntil">>
  ): Promise<void>;
  /**
   * Gives back the quota `failed` codes cost and sets `released`, in one
   * transaction that does nothing when `released` is already set.
   */
  release(failed: number): Promise<void>;
  /** A fresh credential in the batch's format, for a name taken on the router. */
  regenerate(): GeneratedCredential;
  now(): Date;
}

export interface BatchRunOutcome {
  state: BatchState;
  unused: number;
  failed: number;
  /** The router stopped answering; the rest waits for the next run. */
  interrupted: boolean;
}

/**
 * Whether a user found on the router under this code's name is the one this
 * batch put there on an earlier attempt. The password is the proof: it was
 * random and has never left the batch document. Without a password in the
 * response, our unactivated `vc` marker is the next best thing, and the
 * one way that can be wrong is vanishingly rare (another platform user
 * holding the same random name, still unactivated).
 */
export function isOurs(
  found: { comment?: string; password?: string },
  code: Pick<BatchCode, "password">
): boolean {
  if (typeof found.password === "string" && found.password !== "") {
    return found.password === code.password;
  }
  return (found.comment ?? "").slice(0, 2).toLowerCase() === "vc";
}

type Placement =
  | { kind: "placed"; code: BatchCode }
  | { kind: "failed"; code: BatchCode }
  | { kind: "router-down"; error: string };

/**
 * One code onto the router. On a first attempt a name is fresh and random,
 * so it is created without looking first; only a failed create is followed
 * by a look, to tell a clash (rename and try again) from a router that is
 * not answering (stop the run, finish later).
 */
async function place(
  code: BatchCode,
  router: BatchRouter,
  plan: BatchPlanSnapshot,
  deps: BatchRunnerDeps,
  resuming: boolean
): Promise<Placement> {
  let current = code;

  for (let rename = 0; rename <= MAX_RENAMES; rename++) {
    if (resuming || rename > 0) {
      const found = await router.find(current.username);
      if (!found.success) return { kind: "router-down", error: found.error || "Router unreachable" };
      if (found.data) {
        if (isOurs(found.data, current)) {
          return { kind: "placed", code: { ...current, status: "unused", error: null } };
        }
        current = { ...current, ...deps.regenerate() };
        continue;
      }
    }

    const created = await router.create({
      username: current.username,
      password: current.password,
      profile: plan.mikrotikProfile,
      comment: "vc",
      dataLimit: plan.dataLimit,
    });
    if (created.success) {
      return { kind: "placed", code: { ...current, status: "unused", error: null } };
    }

    // Failed: is the name taken, or did the create land and only the answer
    // get lost, or is the router gone? Only a look can tell.
    const found = await router.find(current.username);
    if (!found.success) return { kind: "router-down", error: found.error || created.error || "Router unreachable" };
    if (found.data && isOurs(found.data, current)) {
      return { kind: "placed", code: { ...current, status: "unused", error: null } };
    }
    if (!found.data) {
      // Nothing there and the router answered: the router refused this user
      // (a bad profile, say). Renaming will not help.
      return {
        kind: "failed",
        code: { ...current, status: "failed", error: created.error || "The router refused the code" },
      };
    }
    current = { ...current, ...deps.regenerate() };
  }

  return {
    kind: "failed",
    code: { ...current, status: "failed", error: "Every name tried was already taken on the router" },
  };
}

/**
 * Carries a batch as far as the router allows. Safe to call on a batch in
 * any state, any number of times, as long as the caller holds its lease.
 *
 * `batch.attempts` counts this run: 1 is the request that created it, and
 * only that one may create without looking first.
 */
export async function runBatch(
  batch: VoucherBatch,
  deps: BatchRunnerDeps
): Promise<BatchRunOutcome> {
  const codes = batch.codes.map((c) => ({ ...c }));
  const resuming = batch.attempts > 1;
  let interrupted = false;

  const router = await deps.loadRouter();

  if (!router) {
    for (const c of codes) {
      if (c.status === "pending") {
        c.status = "failed";
        c.error = "The router for this location no longer exists";
      }
    }
  } else {
    const pendingIdx = codes
      .map((c, i) => (c.status === "pending" ? i : -1))
      .filter((i) => i >= 0);

    for (let at = 0; at < pendingIdx.length && !interrupted; at += BATCH_CHUNK_SIZE) {
      const slice = pendingIdx.slice(at, at + BATCH_CHUNK_SIZE);
      const placedNames: string[] = [];
      const changes = new Map<number, BatchCode>();

      for (const i of slice) {
        const result = await place(codes[i], router, batch.plan, deps, resuming);
        if (result.kind === "router-down") {
          interrupted = true;
          break;
        }
        changes.set(i, result.code);
        if (result.kind === "placed") placedNames.push(result.code.username);
      }

      // Index before the codes say "unused": see `indexUnused`.
      if (placedNames.length > 0) await deps.indexUnused(placedNames);
      for (const [i, code] of changes) codes[i] = code;
      await deps.saveProgress(codes, {
        leaseUntil: new Date(deps.now().getTime() + BATCH_LEASE_MS),
      });
    }

    // Out of attempts: whatever is still pending is given up on, so its
    // quota comes back and the owner sees a final answer.
    if (interrupted && batch.attempts >= MAX_BATCH_ATTEMPTS) {
      for (const c of codes) {
        if (c.status === "pending") {
          c.status = "failed";
          c.error = "The router could not be reached";
        }
      }
      interrupted = false;
    }
  }

  const unused = codes.filter((c) => c.status !== "pending" && c.status !== "failed").length;
  const failed = codes.filter((c) => c.status === "failed").length;

  if (interrupted) {
    // Lease dropped so the next poll or cron tick can pick it up at once.
    await deps.saveProgress(codes, { leaseUntil: null });
    return { state: "minting", unused, failed, interrupted: true };
  }

  const state: BatchState = failed === 0 ? "ready" : unused === 0 ? "failed" : "partial";
  await deps.saveProgress(codes, { state, finishedAt: deps.now(), leaseUntil: null });
  if (!batch.released) await deps.release(failed);
  return { state, unused, failed, interrupted: false };
}

/* ------------------------------------------------------------ activation */

export interface ActivationCandidate {
  username: string;
  batchId: string;
  expiresAt: Date;
}

/**
 * Which unused codes somebody has now logged in with, from one listing of
 * the router's users. The profile's on-login script replaces the `vc`
 * marker with the expiry date at first login, so a code in the index whose
 * comment now parses as a date has been used. Pure: the caller supplies the
 * same comment parser the drift view uses.
 */
export function findActivations(
  index: Record<string, string>,
  users: Array<{ name: string; comment?: string }>,
  parseExpiry: (comment: string | undefined) => Date | null
): ActivationCandidate[] {
  const out: ActivationCandidate[] = [];
  for (const user of users) {
    const batchId = index[user.name];
    if (!batchId) continue;
    const expiresAt = parseExpiry(user.comment);
    if (expiresAt) out.push({ username: user.name, batchId, expiresAt });
  }
  return out;
}

/** The voucher document id for a code's first use: one per code, ever. */
export function generatedVoucherId(batchId: string, username: string): string {
  return `gen-${batchId}-${username}`;
}
