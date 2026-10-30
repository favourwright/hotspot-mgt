/**
 * The resumable half of voucher fulfilment: everything that happens after a
 * charge has been verified and the decision of what to do about it has been
 * written down.
 *
 * ## Why this is its own module
 *
 * Fulfilment used to write the payment document first and then talk to the
 * router. A process that died between the two left a payment with no
 * voucher, and every later caller (the browser retrying, the webhook, the
 * reconcile cron) found the payment, reported "already done", and stopped.
 * The customer had paid, had nothing, and nobody was told.
 *
 * Now the decision is persisted first, in a server-only ledger document
 * (`fulfilments/{reference}`), and this runner carries it out one step at a
 * time. Each step either records that it happened or is safe to repeat, so
 * whoever picks the ledger up next - the same process, the webhook, the cron
 * - finishes the job from wherever it stopped, and never does it twice.
 *
 * It is a persisted-intent pattern, not a transaction: the router is not
 * Firestore and cannot take part in one.
 *
 * ## Why every I/O call is injected
 *
 * So `npm run test:fulfilment-ledger` can stop it after every single side
 * effect and prove that a second run finishes with exactly one voucher, one
 * payment, one counter increment and the emails sent. The production
 * implementations live in lib/voucher-fulfilment.ts.
 */

import { parseDataLimitBytes } from "@/lib/mikrotik";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
import type { RenewalModes } from "@/lib/voucher-renewal";

/** How long one caller holds a ledger before another may take it over. */
export const FULFILMENT_LEASE_MS = 3 * 60 * 1000;

/** The plan fields fulfilment needs, frozen at the moment of the sale. */
export interface PlanSnapshot {
  id: string;
  name: string;
  duration: string;
  dataLimit: string | null;
  sharedUsers: string | null;
  mikrotikProfile: string;
  routerDurationValue: number | null;
  routerDurationUnit: "h" | "d" | null;
}

/** What the router will be asked to do, decided before it is asked. */
export type LedgerIntent =
  | {
      kind: "mint" | "revive";
      voucherId: string;
      username: string;
      password: string;
    }
  | {
      kind: "extend";
      voucherId: string;
      username: string;
      password: string;
      previousVoucherId: string;
      /**
       * The exact RouterOS patch, computed once from the router's comment
       * before anything was written. Persisted rather than recomputed
       * because recomputing after the patch landed would read the already
       * extended date and extend it a second time.
       */
      patch: Record<string, string>;
      resetCounters: boolean;
      /** The renewal voucher document, minus status and timestamps. */
      voucherBase: Record<string, unknown>;
      expiresAt: Date;
      modes: RenewalModes;
    };

export interface Ledger {
  reference: string;
  tenantId: string;
  /** The tenant's billing plan, for the customer-limit warning. */
  tenantPlanId: string | null;
  buyer: { uid: string; email: string };
  plan: PlanSnapshot;
  location: { id: string; name: string; routerId: string };
  deviceMac: string | null;
  deviceIp: string | null;
  payment: {
    amountKobo: number;
    subaccountCode: string | null;
    platformShareKobo: number | null;
    tenantShareKobo: number | null;
    hasSubaccount: boolean;
  };
  intent: LedgerIntent;

  state: "started" | "complete";
  leaseUntil: Date;
  attempts: number;

  // Progress. Each is written once its step has happened.
  bookkeepingApplied: boolean;
  router: { ok: boolean; error: string | null } | null;
  autoLogin: boolean;
  /** Set only by a first-attempt auto-login, which starts the clock. */
  activatedExpiresAt: Date | null;
  voucherWritten: boolean;
  paymentWritten: boolean;
  /**
   * The tenant's webhook events were recorded (lib/webhooks.ts). Absent on
   * ledgers written before webhooks existed, which reads as false.
   */
  eventsEmitted?: boolean;
  notifiedAt: Date | null;
}

export type LedgerProgress = Partial<
  Pick<
    Ledger,
    | "state"
    | "router"
    | "autoLogin"
    | "activatedExpiresAt"
    | "voucherWritten"
    | "paymentWritten"
    | "eventsEmitted"
    | "notifiedAt"
  >
>;

interface RouterResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface RunnerRouter {
  find(username: string): Promise<RouterResult<{ comment?: string } | null>>;
  create(user: {
    username: string;
    password: string;
    profile: string;
    comment: string;
    dataLimit: string | null;
  }): Promise<RouterResult>;
  revive(
    username: string,
    user: { password: string; profile: string; dataLimit: string | null }
  ): Promise<RouterResult>;
  update(username: string, patch: Record<string, string>): Promise<RouterResult>;
  resetCounters(username: string): Promise<RouterResult>;
  login(args: {
    mac: string;
    ip: string;
    username: string;
    password: string;
  }): Promise<RouterResult>;
}

export interface RunnerDeps {
  now(): Date;
  /** Writes progress onto the ledger document. */
  markLedger(patch: LedgerProgress): Promise<void>;
  /**
   * Customer counters plus the ledger's `bookkeepingApplied` flag, in one
   * transaction. Returns null when the flag was already set (nothing done),
   * otherwise whether this sale created the customer record.
   */
  applyBookkeeping(): Promise<{ newCustomer: boolean } | null>;
  checkCustomerLimit(): Promise<void>;
  /** Null when the router document no longer exists. */
  loadRouter(): Promise<RunnerRouter | null>;
  writeVoucher(voucherId: string, data: Record<string, unknown>): Promise<void>;
  supersede(previousVoucherId: string, byVoucherId: string): Promise<void>;
  /** Idempotent: an existing payment document is success, not an error. */
  createPayment(data: Record<string, unknown>): Promise<void>;
  /**
   * Records the tenant's webhook events for this sale. Returns false when it
   * could not, and must never throw: a webhook problem never fails a sale.
   * Idempotent by event id, so a repeat after a crash records nothing new.
   */
  emitEvents(): Promise<boolean>;
  notify: {
    voucherPending(): Promise<void>;
    ownerVoucherFailed(reason: string): Promise<void>;
    voucherReady(): Promise<void>;
    voucherRenewed(): Promise<void>;
    ownerVoucherSold(): Promise<void>;
  };
}

export interface RunOutcome {
  outcome: "issued" | "pending";
  voucherId: string;
  username: string;
  password: string;
  autoLogin: boolean;
}

/**
 * What a caller that finds an existing ledger should do. Pure, so the whole
 * table is tested without Firestore.
 *
 *  - `done`: complete and the emails have gone; report the voucher.
 *  - `in_progress`: someone holds a live lease; do not touch it.
 *  - `resume`: started (or complete with emails unsent) and the lease has
 *    lapsed, so the holder died; take it over.
 */
export function nextLedgerAction(
  ledger: Pick<Ledger, "state" | "leaseUntil" | "notifiedAt">,
  now: Date
): "done" | "in_progress" | "resume" {
  if (ledger.state === "complete" && ledger.notifiedAt) return "done";
  if (ledger.leaseUntil.getTime() > now.getTime()) {
    // A complete ledger whose emails are pending is still being worked by
    // its holder. Reporting it as done is fine for the caller; only the
    // emails are outstanding.
    return ledger.state === "complete" ? "done" : "in_progress";
  }
  return "resume";
}

/**
 * Whether a hotspot user on the router was created by this app: the `vc`
 * marker written at creation, or the expiry date the profile's on-login
 * script replaces it with. Anything else is a user the tenant made by hand,
 * and this app does not edit those.
 */
export function isPlatformManaged(comment: string | undefined): boolean {
  if (!comment) return false;
  if (comment.slice(0, 2).toLowerCase() === "vc") return true;
  return parseRouterExpiryComment(comment) !== null;
}

/**
 * Carries a ledger through to completion. Safe to call on a ledger in any
 * state, any number of times, as long as the caller holds its lease.
 *
 * `firstAttempt` is true only for the caller that created the ledger. It
 * permits the two things that are only right in the moment of purchase:
 * creating a fresh router user without looking first, and logging the
 * buyer's device in.
 */
export async function runFulfilment(
  ledger: Ledger,
  deps: RunnerDeps,
  opts: { firstAttempt: boolean }
): Promise<RunOutcome> {
  const { intent, plan } = ledger;

  // 1. Bookkeeping. Exactly once, because the flag flips in the same
  //    transaction as the counters.
  if (!ledger.bookkeepingApplied) {
    const applied = await deps.applyBookkeeping();
    ledger.bookkeepingApplied = true;
    if (applied?.newCustomer) await deps.checkCustomerLimit();
  }

  // 2. Router. Repeating it is safe (see `provision`), so it is recorded
  //    after rather than guarded before.
  if (!ledger.router) {
    const router = await deps.loadRouter();
    const result = router
      ? await provision(ledger, router, opts.firstAttempt)
      : { ok: false, error: "Router not found" };

    // Best-effort, and only in the moment of purchase: the buyer is behind
    // the paywall, and this login is their first, which is what starts the
    // router's clock. A resume minutes later has no business logging a
    // device in on the buyer's behalf.
    let autoLogin = false;
    let activatedExpiresAt: Date | null = null;
    if (
      result.ok &&
      router &&
      opts.firstAttempt &&
      ledger.deviceMac &&
      ledger.deviceIp
    ) {
      const login = await router.login({
        mac: ledger.deviceMac,
        ip: ledger.deviceIp,
        username: intent.username,
        password: intent.password,
      });
      autoLogin = login.success;
      if (!login.success) {
        console.warn("Hotspot auto-login failed:", {
          reference: ledger.reference,
          deviceMac: ledger.deviceMac,
          error: login.error,
        });
      }
      // The one place a first purchase's expiry is known without guessing.
      // Otherwise it stays null and the router-health cron reads the real
      // value off the router's comment.
      if (autoLogin && intent.kind !== "extend" && plan.routerDurationValue) {
        activatedExpiresAt = new Date(
          deps.now().getTime() +
            plan.routerDurationValue *
              (plan.routerDurationUnit === "d" ? 86400000 : 3600000)
        );
      }
    }

    await deps.markLedger({ router: result, autoLogin, activatedExpiresAt });
    ledger.router = result;
    ledger.autoLogin = autoLogin;
    ledger.activatedExpiresAt = activatedExpiresAt;
  }

  const routerOk = ledger.router.ok;

  // 3. The voucher document. Guarded by a flag rather than repeated: once
  //    a failed voucher exists the owner can retry it from the Failed Queue,
  //    and a blind re-write would put a voucher they just fixed back to
  //    "failed".
  if (!ledger.voucherWritten) {
    await deps.writeVoucher(intent.voucherId, voucherDocument(ledger));
    if (intent.kind === "extend" && routerOk) {
      await deps.supersede(intent.previousVoucherId, intent.voucherId);
    }
    await deps.markLedger({ voucherWritten: true });
    ledger.voucherWritten = true;
  }

  // 4. The payment document, last of the records: revenue sums payments,
  //    so one exists only for a sale that has a voucher behind it.
  if (!ledger.paymentWritten) {
    await deps.createPayment(paymentDocument(ledger));
    await deps.markLedger({ paymentWritten: true, state: "complete" });
    ledger.paymentWritten = true;
    ledger.state = "complete";
  } else if (ledger.state !== "complete") {
    await deps.markLedger({ state: "complete" });
    ledger.state = "complete";
  }

  // 5. Webhook events, after the records they describe exist. Left unflagged
  //    if it could not run, so a resume tries again; never blocks the emails.
  if (!ledger.eventsEmitted) {
    if (await deps.emitEvents()) {
      await deps.markLedger({ eventsEmitted: true });
      ledger.eventsEmitted = true;
    }
  }

  // 6. Emails, after everything they describe exists. At least once: a
  //    crash between sending and recording costs a duplicate, never a
  //    missing one. Customer first, because the buyer is waiting on it.
  if (!ledger.notifiedAt) {
    if (!routerOk) {
      await deps.notify.voucherPending();
      await deps.notify.ownerVoucherFailed(ledger.router.error || "Unknown error");
    } else {
      if (intent.kind === "extend") await deps.notify.voucherRenewed();
      else await deps.notify.voucherReady();
      await deps.notify.ownerVoucherSold();
    }
    const notifiedAt = deps.now();
    await deps.markLedger({ notifiedAt });
    ledger.notifiedAt = notifiedAt;
  }

  return {
    outcome: routerOk ? "issued" : "pending",
    voucherId: intent.voucherId,
    username: intent.username,
    password: intent.password,
    autoLogin: ledger.autoLogin,
  };
}

/**
 * Puts the intent onto the router. Every branch is safe to repeat:
 *
 *  - extend sends absolute values (the patch was computed once and stored),
 *    so a second send changes nothing;
 *  - mint and revive on a resume look the name up first, and a user that
 *    exists with our marker is ours from the first attempt. It is revived
 *    with the same credentials rather than treated as a collision. If the
 *    first attempt had already logged the device in, reviving resets the
 *    comment and the clock restarts at the next login: that over-delivers
 *    time, which is the right direction for the only mistake this can make.
 */
async function provision(
  ledger: Ledger,
  router: RunnerRouter,
  firstAttempt: boolean
): Promise<{ ok: boolean; error: string | null }> {
  const { intent, plan } = ledger;

  if (intent.kind === "extend") {
    const applied = await router.update(intent.username, intent.patch);
    if (!applied.success) {
      return { ok: false, error: applied.error || "Unknown error" };
    }
    // Deliberately not fatal, as before: counters that did not clear cost
    // the customer data the owner can restore from the router, while
    // failing here would discard a payment that already succeeded.
    if (intent.resetCounters) {
      const cleared = await router.resetCounters(intent.username);
      if (!cleared.success) {
        console.warn("Renewal could not reset data counters:", {
          reference: ledger.reference,
          username: intent.username,
          error: cleared.error,
        });
      }
    }
    return { ok: true, error: null };
  }

  const user = {
    password: intent.password,
    profile: plan.mikrotikProfile,
    dataLimit: plan.dataLimit,
  };
  const create = () =>
    router.create({ username: intent.username, comment: "vc", ...user });
  const revive = () => router.revive(intent.username, user);

  let result: RouterResult;
  if (firstAttempt) {
    // The orchestrator already looked the name up when it chose revive or
    // mint, and a fresh name is random: no second round-trip.
    result = intent.kind === "revive" ? await revive() : await create();
  } else {
    const found = await router.find(intent.username);
    if (!found.success) {
      result = { success: false, error: found.error };
    } else if (!found.data) {
      result = await create();
    } else if (isPlatformManaged(found.data.comment)) {
      result = await revive();
    } else {
      result = {
        success: false,
        error: `Username ${intent.username} is taken by a user this platform does not manage`,
      };
    }
  }

  return result.success
    ? { ok: true, error: null }
    : { ok: false, error: result.error || "Unknown error" };
}

/** The voucher document, in exactly the shape fulfilment always wrote. */
export function voucherDocument(ledger: Ledger): Record<string, unknown> {
  const { intent, plan, router } = ledger;
  const ok = router?.ok === true;
  const failure = ok
    ? {}
    : { failureReason: router?.error || "Unknown error" };

  if (intent.kind === "extend") {
    return {
      ...intent.voucherBase,
      status: ok ? "active" : "failed",
      ...failure,
      expiresAt: ok ? intent.expiresAt : null,
    };
  }

  return {
    userId: ledger.buyer.uid,
    userEmail: ledger.buyer.email,
    planId: plan.id,
    planName: plan.name,
    locationId: ledger.location.id,
    locationName: ledger.location.name,
    tenantId: ledger.tenantId,
    username: intent.username,
    password: intent.password,
    deviceMac: ledger.deviceMac,
    duration: plan.duration,
    dataLimit: plan.dataLimit || null,
    sharedUsers: plan.sharedUsers || null,
    dataLimitBytes: parseDataLimitBytes(plan.dataLimit),
    renewalOf: null,
    status: ok ? "active" : "failed",
    ...failure,
    paystackReference: ledger.reference,
    retryCount: 0,
    expiresAt: ok ? ledger.activatedExpiresAt : null,
  };
}

/** The payment document, in exactly the shape fulfilment always wrote. */
export function paymentDocument(ledger: Ledger): Record<string, unknown> {
  const { payment } = ledger;
  return {
    userId: ledger.buyer.uid,
    userEmail: ledger.buyer.email,
    planId: ledger.plan.id,
    planName: ledger.plan.name,
    locationId: ledger.location.id,
    locationName: ledger.location.name,
    tenantId: ledger.tenantId,
    amount: payment.amountKobo,
    paystackReference: ledger.reference,
    status: "success",
    subaccountCode: payment.subaccountCode,
    // Three genuinely different cases, and collapsing any two of them is
    // how the old code ended up crediting both sides the full amount:
    //   - no subaccount  -> nothing was split, the whole charge settled
    //                       into the platform's own Paystack account
    //   - split reported -> record exactly what Paystack reported
    //   - split missing  -> unknown. Never write a zero for an unknown;
    //                       a zero reads as "earned nothing" forever.
    platformShareKobo: payment.hasSubaccount
      ? payment.platformShareKobo
      : payment.amountKobo,
    tenantShareKobo: payment.hasSubaccount ? payment.tenantShareKobo : 0,
    voucherId: ledger.intent.voucherId,
  };
}
