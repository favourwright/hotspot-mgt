/**
 * Turning a successful Paystack charge into a voucher.
 *
 * This used to live inside the POST handler of /api/payment/verify, which
 * meant **fulfilment existed only as long as the buyer's browser did**. The
 * payment record, the voucher, the router user and both emails all happened
 * in that one call, and if it never landed, Paystack had the money and we had
 * nothing: no record, no alert, no email, and no way to find out.
 *
 * That is not hypothetical. A customer paid 500 naira from a captive portal
 * on 2026-10-11, got no voucher and no email, and the only trace was
 * Paystack's own receipt. The captive portal is exactly where that call is
 * most fragile: the buyer is still behind the paywall, and the bank's 3DS
 * step navigates the page away mid-flow.
 *
 * So the work lives here, and three callers drive it:
 *
 *  - `/api/payment/verify`, the fast path, called by the browser so the
 *    portal can show credentials immediately and log the device in;
 *  - the Paystack `charge.success` webhook, which arrives server-to-server
 *    and does not care whether the browser survived;
 *  - the `payment-reconcile` cron, which asks Paystack what it charged.
 *
 * Whichever gets there first wins, and the others find the work done.
 *
 * ## Verified, decided, then carried out
 *
 * This module verifies the charge and decides what the router should do,
 * then writes that decision to a server-only ledger
 * (`fulfilments/{reference}`) before touching the router.
 * lib/fulfilment-runner.ts carries the decision out step by step. A process
 * that dies partway leaves a ledger the next caller resumes, where it used to
 * leave a payment with no voucher that every later caller reported as
 * "already done".
 *
 * A charge that cleared but cannot be honoured (plan switched off mid
 * checkout, the amount does not match, a router that is gone) is never
 * dropped either: it becomes a `paymentReviews` record and an email to the
 * platform, because the money has moved and a person has to decide.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyPaystackPayment } from "@/lib/paystack";
import {
  createHotspotUser,
  findHotspotUser,
  generateVoucherCredentials,
  loginHotspotMac,
  resetHotspotUserCounters,
  reviveHotspotUser,
  updateHotspotUser,
  type RouterConfig,
} from "@/lib/mikrotik";
import { FieldValue } from "firebase-admin/firestore";
import {
  parsePlan,
  parseLocation,
  getCustomerVouchers,
  getVoucherCredential,
  getTenantCustomerCount,
} from "@/lib/firestore-helpers";
import {
  formatRouterExpiryComment,
  parseRouterExpiryComment,
} from "@/lib/hotspot-users";
import { routerUsernameFor } from "@/lib/voucher-credentials";
import {
  parsePurchaseIntent,
  parseRenewalModes,
  parseRouterLimitBytes,
  renewalDataLimitBytes,
  renewalExpiry,
  resolveVoucherAction,
  type RenewalModes,
  type VoucherAction,
} from "@/lib/voucher-renewal";
import type { Plan, Voucher, VoucherCredential } from "@/types/schemas";
import { getBillingPlanById } from "@/lib/billing-plans";
import {
  notifyLimitApproaching,
  notifyLimitReached,
  notifyOwnerVoucherFailed,
  notifyOwnerVoucherSold,
  notifyPlatformPaymentReview,
  notifyPlatformSplitMismatch,
  notifyVoucherPending,
  notifyVoucherReady,
  notifyVoucherRenewed,
} from "@/lib/notifications";
import { getPlatformConfig } from "@/lib/platform-config";
import {
  estimatePaystackFee,
  expectedTenantShareKobo,
} from "@/lib/paystack-fees";
import { resolvePaystackBearer } from "@/lib/billing-plans";
import {
  FULFILMENT_LEASE_MS,
  isPlatformManaged,
  nextLedgerAction,
  runFulfilment,
  type Ledger,
  type LedgerIntent,
  type RunnerDeps,
  type RunnerRouter,
  type RunOutcome,
} from "@/lib/fulfilment-runner";

export interface FulfilRequest {
  reference: string;
  planId: string;
  locationId: string;
  tenantId: string;
  /** Present for a captive-portal purchase; recorded, never trusted. */
  deviceMac?: string | null;
  /** Needed alongside the MAC to log the device in server-side. */
  deviceIp?: string | null;
  buyer: { uid: string; email: string };
}

export type FulfilResult =
  | {
      ok: true;
      /**
       * `already` means some other caller got here first. `in_progress`
       * means another caller is working on it right now: nothing is wrong,
       * but there is no voucher to hand back yet.
       */
      outcome: "already" | "issued" | "pending" | "in_progress";
      voucherId: string | undefined;
      username?: string;
      password?: string;
      autoLogin?: boolean;
    }
  | { ok: false; status: number; error: string };

function fail(status: number, error: string): FulfilResult {
  return { ok: false, status, error };
}

/**
 * What a buyer sees when their money arrived and we could not honour it
 * automatically. Never the internal reason ("amount does not match"): to the
 * customer that reads like their payment failed, and the one thing they must
 * not do is pay again.
 */
const REVIEW_MESSAGE =
  "Your payment was received, but we couldn't issue your voucher automatically. Support has been alerted and will sort it out - please don't pay again.";

const LEDGER_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Idempotent. Safe to call twice, concurrently, from different processes.
 *
 * The race guard is the ledger document being **created at a deterministic
 * id** derived from the reference. `create()` fails if it exists, so of two
 * callers racing past the first read, exactly one proceeds, and the other
 * finds a live lease and reports `in_progress`.
 */
export async function fulfilVoucherPurchase(
  input: FulfilRequest
): Promise<FulfilResult> {
  const { reference, planId, locationId, tenantId, buyer } = input;
  const deviceMac = input.deviceMac ?? null;
  const deviceIp = input.deviceIp ?? null;
  const { uid: userId, email: userEmail } = buyer;

  const ledgerRef = adminDb
    .collection(COLLECTIONS.FULFILMENTS)
    .doc(paymentDocId(reference));

  const existingLedger = await ledgerRef.get();
  if (existingLedger.exists) {
    return continueExisting(ledgerRef, ledgerFromData(existingLedger.data()!), userId);
  }

  // A sale fulfilled before the ledger existed has a payment and no ledger.
  const existingPayment = await adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .where("paystackReference", "==", reference)
    .limit(1)
    .get();

  if (!existingPayment.empty) {
    const payment = existingPayment.docs[0].data();
    const credentials =
      payment.userId === userId
        ? await readVoucherCredentials(tenantId, payment.voucherId)
        : {};
    return {
      ok: true,
      outcome: "already",
      voucherId: payment.voucherId,
      ...credentials,
    };
  }

  // Fails for anything but a successful charge, so there is no separate
  // status check to make here.
  const paymentResult = await verifyPaystackPayment(reference);
  if (!paymentResult.success || !paymentResult.data) {
    return fail(400, "Payment verification failed");
  }
  const paymentData = paymentResult.data;

  // The reference is the only thing the browser supplies that this route
  // acts on, and a reference is just a string - so the charge has to agree
  // that this is the person who made it. Both checkout paths stamp
  // `userId` into the metadata (for the webhook's benefit), which makes the
  // transaction itself say who bought it.
  //
  // Without this, a signed-in customer who came by somebody else's genuine
  // reference could present it here and have the voucher minted in their own
  // name: the amount, plan and tenant all check out, because it is a real
  // purchase. It just is not theirs. The addon activate route checks the
  // same thing against the payer's email.
  //
  // Only enforced when the metadata actually carries a uid. A charge from
  // before this field existed, or one recovered by the reconciliation job
  // from Paystack's own records, has nothing to compare and is left to the
  // checks below.
  //
  // Not a review case: the charge is real and belongs to someone else, whose
  // own webhook will fulfil it.
  const chargedUserId = paymentData.metadata?.userId;
  if (
    typeof chargedUserId === "string" &&
    chargedUserId &&
    chargedUserId !== userId
  ) {
    console.warn(
      `[fulfilment] ${reference} was bought by ${chargedUserId}, refusing to fulfil it for ${userId}`
    );
    // Deliberately the same message a bad reference gets: a caller holding
    // somebody else's reference learns nothing about whose it is.
    return fail(400, "Payment verification failed");
  }

  // From here on the money has moved. Every refusal is recorded.
  const review = (status: number, kind: PaymentReviewKind, detail: string) =>
    refuseForReview(status, {
      reference,
      tenantId,
      kind,
      detail,
      amountKobo: paymentData.amount,
      currency: paymentData.currency,
      chargedEmail: paymentData.customerEmail,
    });

  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  if (!tenantDoc.exists) {
    return review(404, "tenant_missing", "Tenant not found");
  }
  const tenantData = tenantDoc.data()!;

  if (paymentData.currency !== "NGN") {
    return review(
      400,
      "currency_mismatch",
      `Charged in ${paymentData.currency}, expected NGN`
    );
  }

  // Logged, never blocking: the customer already paid, and refusing them a
  // voucher over a bookkeeping mismatch punishes the wrong person.
  if (
    tenantData.paystackSubaccountCode &&
    paymentData.subaccount?.subaccountCode !== tenantData.paystackSubaccountCode
  ) {
    console.warn("Subaccount mismatch on payment:", {
      reference,
      expected: tenantData.paystackSubaccountCode,
      received: paymentData.subaccount?.subaccountCode,
    });
  }

  const planDoc = await adminDb
    .collection(TENANT_COLLECTIONS.plans(tenantId))
    .doc(planId)
    .get();
  const plan = parsePlan(planDoc);
  if (!plan) return review(404, "plan_missing", `Plan ${planId} not found`);
  if (!plan.active) {
    return review(400, "plan_inactive", `Plan ${plan.name} is no longer active`);
  }

  const platformConfig = await getPlatformConfig();
  const expectedFee = estimatePaystackFee(
    plan.price,
    platformConfig.paystackFeePassthrough
  );
  if (paymentData.amount !== plan.price + expectedFee) {
    return review(
      400,
      "amount_mismatch",
      `Charged ${paymentData.amount} kobo, expected ${plan.price + expectedFee}`
    );
  }

  if (paymentData.subaccount) {
    // Mirrors what `computeCheckoutSplit` instructed Paystack to do,
    // including who bears Paystack's own fee. Working this out independently
    // of the function that sent the split is how a correctly configured
    // comped tenant generated a mismatch alert on every sale.
    const expectedTenantShare = expectedTenantShareKobo({
      chargedKobo: paymentData.amount,
      priceKobo: plan.price,
      feeKobo: expectedFee,
      platformFeePercent: tenantData.platformFeePercent,
      bearer: await resolvePaystackBearer(tenantData.planId),
      paystackFeeKobo: paymentData.subaccount.paystackFeeKobo,
    });
    const actualTenantShare = paymentData.subaccount.tenantShareKobo;
    if (actualTenantShare === null) {
      console.warn("Paystack reported no fees_split for a split charge:", {
        reference,
        subaccountCode: paymentData.subaccount.subaccountCode,
      });
    } else if (actualTenantShare !== expectedTenantShare) {
      console.warn("Tenant settlement share mismatch on payment:", {
        reference,
        expected: expectedTenantShare,
        received: actualTenantShare,
      });
      await notifyPlatformSplitMismatch({
        tenantId,
        reference,
        expectedKobo: expectedTenantShare,
        receivedKobo: actualTenantShare,
        amountKobo: paymentData.amount,
      });
    }
  }

  const locationDoc = await adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .doc(locationId)
    .get();
  const location = parseLocation(locationDoc);
  if (!location) {
    return review(404, "location_missing", `Location ${locationId} not found`);
  }
  if (!location.active) {
    return review(
      400,
      "location_inactive",
      `Location ${location.name} is no longer active`
    );
  }

  const routerDoc = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .doc(location.routerId)
    .get();
  if (!routerDoc.exists) {
    return review(404, "router_missing", `Router ${location.routerId} not found`);
  }
  const routerData = routerDoc.data()!;
  if (!routerData.active) {
    return review(400, "router_inactive", "Router is not active");
  }

  const routerConfig: RouterConfig = {
    ip: routerData.routerIp,
    username: routerData.routerUser,
    password: routerData.routerPass,
  };

  // ------------------------------------------- renew, or mint a new code?
  //
  // Everything above this point is unchanged by plan: it verifies the money.
  // From here the question is what the purchase should do to the router, and
  // the answer is no longer "always create another user". See
  // lib/voucher-renewal.ts for why there are three answers and not one.
  const now = new Date();
  const history = await getCustomerVouchers(tenantId, userId);
  const credential = await getVoucherCredential(tenantId, userId);
  const savedUsername = credential
    ? routerUsernameFor(credential.handle, credential.suffix)
    : null;

  // The buyer's own answer, read off the charge rather than inferred.
  // Paystack returns the metadata the checkout attached, so the browser,
  // the `charge.success` webhook and the reconciliation cron all reach the
  // same decision for the same sale. Anything missing or unrecognised
  // means "reuse", which is the behaviour that shipped first.
  const purchaseIntent = parsePurchaseIntent(
    (paymentData.metadata as Record<string, unknown> | undefined)?.intent
  );

  const action = resolveVoucherAction(history, {
    planId,
    locationId,
    now,
    intent: purchaseIntent,
    savedUsername,
  });

  const voucherId = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .doc().id;

  let intent: LedgerIntent | null = null;

  if (action.kind === "extend") {
    // Null means the credential it meant to extend is no longer on the
    // router, or carries a comment in no format we can safely rewrite.
    // Neither is worth failing a paid purchase over, so it falls through
    // and mints a fresh code the way it always did.
    intent = await planExtension({
      voucherId,
      routerConfig,
      previous: action.voucher,
      plan,
      now,
      deviceMac,
      buyer,
      reference,
      locationName: location.name,
      tenantId,
      modes: parseRenewalModes(tenantData),
    });
  }

  // `action.kind === "unactivated"` deliberately does nothing here. Refusing
  // a purchase is something that happens before Paystack opens
  // (/api/tenant/[slug]/can-purchase); once the money has moved, the rule
  // this codebase holds everywhere is that a payment which already succeeded
  // is never undone by anything downstream. So an unused voucher that got
  // past the pre-check simply produces a second one.
  if (!intent) {
    intent = await planMintOrRevive({
      voucherId,
      action,
      credential,
      plan,
      routerConfig,
    });
  }

  const ledger: Ledger = {
    reference,
    tenantId,
    tenantPlanId: tenantData.planId ?? null,
    buyer: { uid: userId, email: userEmail },
    plan: planSnapshot(plan),
    location: { id: location.id, name: location.name, routerId: location.routerId },
    deviceMac,
    deviceIp,
    payment: {
      amountKobo: paymentData.amount,
      subaccountCode: paymentData.subaccount?.subaccountCode || null,
      platformShareKobo: paymentData.subaccount?.platformShareKobo ?? null,
      tenantShareKobo: paymentData.subaccount?.tenantShareKobo ?? null,
      hasSubaccount: Boolean(paymentData.subaccount),
    },
    intent,
    state: "started",
    leaseUntil: new Date(now.getTime() + FULFILMENT_LEASE_MS),
    attempts: 1,
    bookkeepingApplied: false,
    router: null,
    autoLogin: false,
    activatedExpiresAt: null,
    voucherWritten: false,
    paymentWritten: false,
    notifiedAt: null,
  };

  // The race guard. Deterministic id, created rather than set: if another
  // caller beat us here, this throws and we defer to its ledger instead of
  // minting a second voucher against one charge.
  try {
    await ledgerRef.create({
      ...ledger,
      createdAt: FieldValue.serverTimestamp(),
      // Firestore TTL field. Long enough to reconcile against; the payment
      // document is the permanent record.
      deleteAt: new Date(now.getTime() + LEDGER_RETENTION_MS),
    });
  } catch (error) {
    if ((error as { code?: number })?.code === 6) {
      const raced = await ledgerRef.get();
      return continueExisting(ledgerRef, ledgerFromData(raced.data()!), userId);
    }
    throw error;
  }

  const run = await runFulfilment(ledger, productionDeps(ledger, ledgerRef), {
    firstAttempt: true,
  });
  return fromRun(run, true);
}

/** A caller found a ledger already there: report it, wait, or take it over. */
async function continueExisting(
  ledgerRef: FirebaseFirestore.DocumentReference,
  ledger: Ledger,
  callerUid: string
): Promise<FulfilResult> {
  const isBuyer = ledger.buyer.uid === callerUid;
  const action = nextLedgerAction(ledger, new Date());

  if (action === "in_progress") {
    return { ok: true, outcome: "in_progress", voucherId: undefined };
  }

  if (action === "done") {
    return {
      ok: true,
      outcome: "already",
      voucherId: ledger.intent.voucherId,
      ...(isBuyer
        ? { username: ledger.intent.username, password: ledger.intent.password }
        : {}),
    };
  }

  const claimed = await claimLease(ledgerRef);
  if (!claimed) {
    return { ok: true, outcome: "in_progress", voucherId: undefined };
  }

  const wasComplete = claimed.state === "complete";
  console.warn(
    `[fulfilment] resuming ${claimed.reference} (attempt ${claimed.attempts}, ` +
      `${wasComplete ? "emails only" : "unfinished"})`
  );
  const run = await runFulfilment(claimed, productionDeps(claimed, ledgerRef), {
    firstAttempt: false,
  });

  if (wasComplete) {
    return {
      ok: true,
      outcome: "already",
      voucherId: run.voucherId,
      ...(isBuyer ? { username: run.username, password: run.password } : {}),
    };
  }
  return fromRun(run, isBuyer);
}

/**
 * Takes over a ledger whose holder's lease has run out. Transactional, so
 * of several callers arriving at once exactly one resumes.
 */
async function claimLease(
  ledgerRef: FirebaseFirestore.DocumentReference
): Promise<Ledger | null> {
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ledgerRef);
    if (!snap.exists) return null;
    const ledger = ledgerFromData(snap.data()!);
    const now = new Date();
    if (nextLedgerAction(ledger, now) !== "resume") return null;

    const leaseUntil = new Date(now.getTime() + FULFILMENT_LEASE_MS);
    const attempts = ledger.attempts + 1;
    tx.update(ledgerRef, { leaseUntil, attempts });
    return { ...ledger, leaseUntil, attempts };
  });
}

function fromRun(run: RunOutcome, isBuyer: boolean): FulfilResult {
  if (run.outcome === "pending") {
    return { ok: true, outcome: "pending", voucherId: run.voucherId };
  }
  return {
    ok: true,
    outcome: "issued",
    voucherId: run.voucherId,
    ...(isBuyer
      ? { username: run.username, password: run.password, autoLogin: run.autoLogin }
      : {}),
  };
}

/* ------------------------------------------------------- deciding */

async function planMintOrRevive(args: {
  voucherId: string;
  action: VoucherAction;
  credential: VoucherCredential | null;
  plan: Plan;
  routerConfig: RouterConfig;
}): Promise<LedgerIntent> {
  const { action, credential, plan, routerConfig } = args;

  const credentials =
    action.kind === "revive"
      ? reusedCredentials(action, credential, plan)
      : { ...generateVoucherCredentials(plan.sameCredentials ?? true), reused: false };

  // Only a reused name can already exist. A freshly generated one is eight
  // random characters, and looking it up would be a router round-trip to
  // learn nothing.
  const found = credentials.reused
    ? (await findHotspotUser(routerConfig, credentials.username)).data ?? null
    : null;

  // Absent is fine and expected: the `voucher-reap` cron deletes a hotspot
  // user a fortnight after it expires, so a customer coming back after that
  // still gets the code they know, created afresh.
  const revivable = found !== null && isPlatformManaged(found.comment);

  // Standing on somebody else's name is the one outcome worse than not
  // honouring the chosen one. The suffix makes a collision with a user the
  // tenant made by hand in Winbox vanishingly unlikely, but "unlikely" is
  // not the standard for overwriting somebody's own router config - so
  // anything without our marker falls all the way back to a random code.
  // Settled before the ledger is written, because the voucher document and
  // the router user have to agree on what the username is.
  if (found !== null && !revivable) {
    const fallback = generateVoucherCredentials(plan.sameCredentials ?? true);
    credentials.username = fallback.username;
    credentials.password = fallback.password;
  }

  return {
    kind: revivable ? "revive" : "mint",
    voucherId: args.voucherId,
    username: credentials.username,
    password: credentials.password,
  };
}

/**
 * Works out how to top up a credential the customer is already using,
 * instead of handing them a second one. Reads the router; writes nothing.
 *
 * Returns null when it cannot do that safely, in which case the caller
 * mints a fresh voucher as before. Two reasons for that, both real: the
 * router user may be gone (deleted by hand in Winbox, which tenants do), and
 * its comment may be in a format `formatRouterExpiryComment` does not
 * recognise, which means the router's own script cannot read it either and
 * writing a date into it would expire nobody.
 *
 * ## Why the targets are absolute, and computed only once
 *
 * Both the new expiry and the new byte cap are computed here, stored in the
 * ledger, and only then sent to the router. They are absolute values, never
 * "whatever is there plus the plan", so the retry path, a replay, or a
 * resume all send the same two numbers and the customer cannot be topped up
 * twice for one payment. Computing them again on a resume would be wrong in
 * exactly that way: it would read the comment the first attempt already
 * extended.
 */
async function planExtension(args: {
  voucherId: string;
  tenantId: string;
  routerConfig: RouterConfig;
  previous: Voucher;
  plan: Plan;
  now: Date;
  deviceMac: string | null;
  buyer: { uid: string; email: string };
  reference: string;
  locationName: string;
  /** The tenant's house rules for what renewing means. */
  modes: RenewalModes;
}): Promise<LedgerIntent | null> {
  const { routerConfig, previous, plan, now, modes } = args;

  const found = await findHotspotUser(routerConfig, previous.username);
  if (!found.success || !found.data) return null;

  const routerUser = found.data;

  // Counted from the **router's** comment rather than our `expiresAt`, and
  // that is not a stylistic preference.
  //
  // The router owns expiry, and it writes and reads that comment against
  // its own clock, which is the tenant's local time. Our copy of the date
  // is sometimes a UTC instant computed here at auto-login instead, and
  // rendering that back into a comment would hand the router a wall-clock
  // time an hour out and expire the customer early. Parsing and formatting
  // are symmetric (`parseRouterExpiryComment` / `formatRouterExpiryComment`
  // in lib/hotspot-users.ts), so going through the comment makes the new
  // date exactly the old one plus the plan, whatever either clock thinks.
  const runningUntil = parseRouterExpiryComment(routerUser.comment);
  if (!runningUntil) return null;

  const expiresAt = renewalExpiry(runningUntil, now, plan, modes.expiry);
  const comment = formatRouterExpiryComment(expiresAt, routerUser.comment);
  if (!comment) return null;

  const previousLimitBytes = parseRouterLimitBytes(
    routerUser["limit-bytes-total"]
  );

  const dataLimitBytes = renewalDataLimitBytes(
    previousLimitBytes,
    plan.dataLimit,
    modes.data
  );

  // What the credential had spent, read before anything is written. Under
  // `data: "reset"` the counters are about to be zeroed and this is the
  // only place that figure survives; under `"carry"` it is still worth
  // keeping, because it is what the carried-over remainder was measured
  // against. Lifetime counters only - an open session is not folded into
  // them until it ends (docs/captive-portal.md), so this is a floor.
  const previousBytesIn = Number(routerUser["bytes-in"] ?? 0);
  const previousBytesOut = Number(routerUser["bytes-out"] ?? 0);
  const previousBytesUsed =
    Number.isFinite(previousBytesIn) && Number.isFinite(previousBytesOut)
      ? previousBytesIn + previousBytesOut
      : null;

  const voucherBase = {
    userId: args.buyer.uid,
    userEmail: args.buyer.email,
    planId: plan.id,
    planName: plan.name,
    locationId: previous.locationId,
    locationName: args.locationName,
    tenantId: args.tenantId,
    username: previous.username,
    password: previous.password,
    // Recorded when the renewal came through the portal, same as a first
    // purchase. It is also what keeps the portal's "welcome back, your plan
    // has ended" card off the screen of someone who just topped up: that
    // card is driven by the newest voucher for the device.
    // Falls back to the credential's own last known device. A renewal
    // bought from the ordinary storefront has no MAC to attribute, and
    // writing null would make the newest voucher for this code one with no
    // device - losing `lastVoucherForDevice`, the portal's "welcome back"
    // card and the plan's shared-device count for a customer who has
    // changed nothing about how they connect.
    deviceMac: args.deviceMac ?? previous.deviceMac ?? null,
    duration: plan.duration,
    dataLimit: plan.dataLimit || null,
    sharedUsers: plan.sharedUsers || null,
    dataLimitBytes,
    renewalOf: previous.id,
    // What this renewal did to the credential it took over, at the moment
    // it did it. The modes are copied in rather than looked up later: an
    // owner who switches a setting next month must not thereby change what
    // this renewal is recorded as having done. See `Voucher.renewal`.
    renewal: {
      expiryMode: modes.expiry,
      dataMode: modes.data,
      previousVoucherId: previous.id,
      previousExpiresAt: runningUntil,
      previousLimitBytes,
      previousBytesUsed,
    },
    paystackReference: args.reference,
    retryCount: 0,
  };

  // The patch RouterOS gets. `limit-uptime` is sent only when the sweeper
  // has already clamped it, which it should not have for a voucher still
  // running - but the sweeper can fire between the read above and this
  // write, and a user left clamped at 1s cannot log in however far into the
  // future their comment says they are good for.
  const patch: Record<string, string> = {
    comment,
    "limit-bytes-total": String(dataLimitBytes ?? 0),
    // Re-applied every renewal, because this is the one moment we know the
    // plan and the credential are meant to agree. A tenant who edited the
    // plan's MikroTik profile since the first purchase would otherwise have
    // the new voucher document claiming the new speed and duration while
    // the router went on enforcing the old profile.
    profile: plan.mikrotikProfile,
  };
  if (routerUser["limit-uptime"] === "1s") {
    patch["limit-uptime"] = "0";
  }

  return {
    kind: "extend",
    voucherId: args.voucherId,
    username: previous.username,
    password: previous.password,
    previousVoucherId: previous.id,
    patch,
    // Under `data: "reset"` the cap above is the plan's own allowance,
    // which means nothing unless what the customer already spent is cleared
    // with it: RouterOS measures lifetime counters against that one number.
    resetCounters: modes.data === "reset",
    voucherBase,
    expiresAt,
    modes,
  };
}

function planSnapshot(plan: Plan): Ledger["plan"] {
  return {
    id: plan.id,
    name: plan.name,
    duration: plan.duration,
    dataLimit: plan.dataLimit ?? null,
    sharedUsers: plan.sharedUsers ?? null,
    mikrotikProfile: plan.mikrotikProfile,
    routerDurationValue: plan.routerDurationValue ?? null,
    routerDurationUnit: plan.routerDurationUnit ?? null,
  };
}

/* ------------------------------------------------- carrying it out */

function productionDeps(
  ledger: Ledger,
  ledgerRef: FirebaseFirestore.DocumentReference
): RunnerDeps {
  const { tenantId, plan, buyer, payment, intent } = ledger;
  const amountKobo = payment.amountKobo;
  const tenantShareKobo = payment.hasSubaccount ? payment.tenantShareKobo : null;

  return {
    now: () => new Date(),

    markLedger: async (patch) => {
      await ledgerRef.update(patch);
    },

    // Bookkeeping only: the real enforcement of maxCustomers happens before
    // Paystack ever opens.
    applyBookkeeping: () =>
      adminDb.runTransaction(async (tx) => {
        const current = await tx.get(ledgerRef);
        if (current.data()?.bookkeepingApplied) return null;

        const customerRef = adminDb
          .collection(TENANT_COLLECTIONS.customers(tenantId))
          .doc(buyer.uid);
        const customer = await tx.get(customerRef);

        if (customer.exists) {
          tx.update(customerRef, {
            totalVouchers: FieldValue.increment(1),
            totalSpent: FieldValue.increment(amountKobo),
          });
        } else {
          tx.set(customerRef, {
            uid: buyer.uid,
            email: buyer.email,
            totalVouchers: 1,
            totalSpent: amountKobo,
            joinedAt: FieldValue.serverTimestamp(),
          });
        }
        tx.update(ledgerRef, { bookkeepingApplied: true });
        return { newCustomer: !customer.exists };
      }),

    checkCustomerLimit: async () => {
      if (!ledger.tenantPlanId) return;
      const tenantPlan = await getBillingPlanById(ledger.tenantPlanId);
      const maxCustomers = tenantPlan?.limits.maxCustomers ?? null;
      if (maxCustomers === null) return;
      const newCount = await getTenantCustomerCount(tenantId);
      if (newCount >= maxCustomers) {
        await notifyLimitReached(tenantId, "maxCustomers", maxCustomers);
      } else if (newCount >= Math.ceil(maxCustomers * 0.8)) {
        await notifyLimitApproaching(
          tenantId,
          "maxCustomers",
          newCount,
          maxCustomers
        );
      }
    },

    loadRouter: async () => {
      const routerDoc = await adminDb
        .collection(TENANT_COLLECTIONS.routers(tenantId))
        .doc(ledger.location.routerId)
        .get();
      if (!routerDoc.exists) return null;
      const data = routerDoc.data()!;
      return routerPort({
        ip: data.routerIp,
        username: data.routerUser,
        password: data.routerPass,
      });
    },

    writeVoucher: async (voucherId, data) => {
      await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .doc(voucherId)
        .set({ ...data, createdAt: FieldValue.serverTimestamp() });
    },

    // The old document stops being the live one. A distinct status rather
    // than an early "expired", because the voucher-expiry cron acts on
    // "active" and would otherwise either email "your access ends in an
    // hour" about a plan that was just topped up, or close it out on a date
    // that no longer applies.
    supersede: async (previousVoucherId, byVoucherId) => {
      await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .doc(previousVoucherId)
        .update({
          status: "superseded",
          supersededAt: FieldValue.serverTimestamp(),
          supersededBy: byVoucherId,
        });
    },

    createPayment: async (data) => {
      try {
        await adminDb
          .collection(TENANT_COLLECTIONS.payments(tenantId))
          .doc(paymentDocId(ledger.reference))
          .create({ ...data, createdAt: FieldValue.serverTimestamp() });
      } catch (error) {
        // Written by an earlier attempt that died before recording it.
        if ((error as { code?: number })?.code === 6) return;
        throw error;
      }
    },

    // Both sides of a failed activation get told. The customer is owed an
    // explanation for money that left their account with nothing to show
    // for it, and the owner would otherwise only find out by happening to
    // open the Failed Queue.
    notify: {
      voucherPending: () =>
        notifyVoucherPending({
          tenantId,
          customerEmail: buyer.email,
          planName: plan.name,
          locationName: ledger.location.name,
          amountKobo,
          reference: ledger.reference,
        }),
      ownerVoucherFailed: (failureReason) =>
        notifyOwnerVoucherFailed({
          tenantId,
          customerEmail: buyer.email,
          planName: plan.name,
          locationName: ledger.location.name,
          failureReason,
          amountKobo,
        }),
      // The lasting copy of the credentials, and the one the portal buyer
      // needs most: the dialog shows them exactly once.
      voucherReady: () =>
        notifyVoucherReady({
          tenantId,
          customerEmail: buyer.email,
          planName: plan.name,
          locationName: ledger.location.name,
          username: intent.username,
          password: intent.password,
          duration: plan.duration,
          dataLimit: plan.dataLimit,
          sharedUsers: plan.sharedUsers,
          amountKobo,
          reference: ledger.reference,
        }),
      voucherRenewed: async () => {
        if (intent.kind !== "extend") return;
        await notifyVoucherRenewed({
          tenantId,
          customerEmail: buyer.email,
          planName: plan.name,
          locationName: ledger.location.name,
          username: intent.username,
          password: intent.password,
          duration: plan.duration,
          dataLimit: plan.dataLimit,
          sharedUsers: plan.sharedUsers,
          amountKobo,
          reference: ledger.reference,
          expiresAt: intent.expiresAt,
          modes: intent.modes,
        });
      },
      // `tenantShareKobo` is passed through as-is, null included. Paystack
      // can name a subaccount and report no `fees_split`, and that is
      // unknown rather than zero - telling an owner they earned nothing
      // from a sale they did earn from is worse than telling them nothing.
      ownerVoucherSold: () =>
        notifyOwnerVoucherSold({
          tenantId,
          customerEmail: buyer.email,
          planName: plan.name,
          locationName: ledger.location.name,
          amountKobo,
          tenantShareKobo,
        }),
    },
  };
}

function routerPort(config: RouterConfig): RunnerRouter {
  return {
    find: (username) => findHotspotUser(config, username),
    create: (user) =>
      createHotspotUser(config, user),
    revive: (username, user) => reviveHotspotUser(config, username, user),
    update: (username, patch) => updateHotspotUser(config, username, patch),
    resetCounters: (username) => resetHotspotUserCounters(config, username),
    login: (args) => loginHotspotMac(config, args),
  };
}

/* ------------------------------------------------------- reviews */

export type PaymentReviewKind =
  | "tenant_missing"
  | "currency_mismatch"
  | "plan_missing"
  | "plan_inactive"
  | "amount_mismatch"
  | "location_missing"
  | "location_inactive"
  | "router_missing"
  | "router_inactive";

/**
 * A charge that cleared and cannot be honoured automatically. Recorded once
 * per reference (the browser, the webhook and the cron will all arrive
 * here for the same charge) and emailed to the platform on the first
 * arrival only. `payment-reconcile` treats a reference with a review as
 * handled, rather than retrying it every fifteen minutes for a day.
 */
async function refuseForReview(
  status: number,
  review: {
    reference: string;
    tenantId: string;
    kind: PaymentReviewKind;
    detail: string;
    amountKobo: number;
    currency: string;
    chargedEmail: string;
  }
): Promise<FulfilResult> {
  console.error(
    `[fulfilment] ${review.reference} paid but not fulfilled: ${review.kind} (${review.detail})`
  );
  try {
    await adminDb
      .collection(COLLECTIONS.PAYMENT_REVIEWS)
      .doc(paymentDocId(review.reference))
      .create({
        ...review,
        createdAt: FieldValue.serverTimestamp(),
        resolvedAt: null,
        resolution: null,
      });
    await notifyPlatformPaymentReview(review);
  } catch (error) {
    // Already recorded by an earlier arrival: nothing more to say.
    if ((error as { code?: number })?.code !== 6) throw error;
  }
  return fail(status, REVIEW_MESSAGE);
}

/* ------------------------------------------------------- helpers */

/**
 * A Paystack reference used as a Firestore document id.
 *
 * References are generated by this app as `hs_<millis>_<suffix>`, which is
 * already id-safe, but a reference that ever arrives from elsewhere must not
 * be able to contain a `/` and address a different path.
 */
export function paymentDocId(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150);
}

/** Firestore hands Dates back as Timestamps. */
function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return new Date(value as string | number);
}

function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

function ledgerFromData(data: FirebaseFirestore.DocumentData): Ledger {
  const intent = data.intent as LedgerIntent;
  return {
    ...(data as Ledger),
    leaseUntil: toDate(data.leaseUntil),
    activatedExpiresAt: toDateOrNull(data.activatedExpiresAt),
    notifiedAt: toDateOrNull(data.notifiedAt),
    intent:
      intent.kind === "extend"
        ? { ...intent, expiresAt: toDate(intent.expiresAt) }
        : intent,
  };
}

/**
 * Reads a voucher's credentials back for a caller replaying a sale made
 * before the ledger existed. Returns nothing rather than throwing: the
 * payment is already recorded, and failing here must not turn a successful
 * purchase into an error the buyer sees.
 */
async function readVoucherCredentials(
  tenantId: string,
  voucherId: string | undefined
): Promise<{ username?: string; password?: string }> {
  if (!voucherId) return {};
  try {
    const doc = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(voucherId)
      .get();
    const data = doc.data();
    if (!data) return {};
    return { username: data.username, password: data.password };
  } catch (error) {
    console.error("Failed to re-read voucher credentials:", error);
    return {};
  }
}

/**
 * The username and password a reused login keeps.
 *
 * The name is settled already - `resolveVoucherAction` chose it. This only
 * has to decide which password goes with it, and the answer is always "the
 * one that already goes with it", because the point of reusing a login is
 * that the customer does not have to learn anything new. Their profile
 * credential wins when the name is that one; otherwise the old voucher's
 * own password carries over.
 *
 * A past voucher with no password on record falls back to a generated one
 * under the same name, which is the only case here where the customer has
 * to read something off an email again.
 */
function reusedCredentials(
  action: Extract<VoucherAction, { kind: "revive" }>,
  credential: VoucherCredential | null,
  plan: Plan
): { username: string; password: string; reused: boolean } {
  const saved =
    credential &&
    routerUsernameFor(credential.handle, credential.suffix) === action.username
      ? credential.password
      : null;

  return {
    username: action.username,
    password:
      saved ??
      action.previous?.password ??
      generateVoucherCredentials(plan.sameCredentials ?? true).password,
    reused: true,
  };
}
