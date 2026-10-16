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
 * So the work lives here, and two callers drive it:
 *
 *  - `/api/payment/verify`, the fast path, called by the browser so the
 *    portal can show credentials immediately and log the device in;
 *  - the Paystack `charge.success` webhook, which arrives server-to-server
 *    and does not care whether the browser survived.
 *
 * Whichever gets there first wins, and the other finds the work done.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyPaystackPayment } from "@/lib/paystack";
import {
  createHotspotUser,
  findHotspotUser,
  generateVoucherCredentials,
  loginHotspotMac,
  parseDataLimitBytes,
  reviveHotspotUser,
  updateHotspotUser,
} from "@/lib/mikrotik";
import { FieldValue } from "firebase-admin/firestore";
import {
  parsePlan,
  parseLocation,
  getCustomerVouchers,
  getTenantCustomer,
  getVoucherCredential,
  getTenantCustomerCount,
} from "@/lib/firestore-helpers";
import {
  formatRouterExpiryComment,
  parseRouterExpiryComment,
} from "@/lib/hotspot-users";
import { routerUsernameFor } from "@/lib/voucher-credentials";
import {
  parseRouterLimitBytes,
  renewalDataLimitBytes,
  renewalExpiry,
  resolveVoucherAction,
} from "@/lib/voucher-renewal";
import type { Plan, Voucher, VoucherCredential } from "@/types/schemas";
import { getBillingPlanById } from "@/lib/billing-plans";
import {
  notifyLimitApproaching,
  notifyLimitReached,
  notifyOwnerVoucherFailed,
  notifyOwnerVoucherSold,
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
      /** `already` means some other caller got here first. */
      outcome: "already" | "issued" | "pending";
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
 * Idempotent. Safe to call twice, concurrently, from different processes.
 *
 * Two layers guard that, because the browser and the webhook genuinely can
 * run at the same moment:
 *
 *  1. a query for an existing payment with this reference, which catches the
 *     ordinary "already done" case cheaply;
 *  2. the payment document being **created at a deterministic id** derived
 *     from the reference. `create()` fails if the document exists, so of two
 *     callers racing past the query, exactly one proceeds. A random id with a
 *     prior query is a check-then-act, and it loses that race by issuing two
 *     vouchers for one payment.
 */
export async function fulfilVoucherPurchase(
  input: FulfilRequest
): Promise<FulfilResult> {
  const { reference, planId, locationId, tenantId, buyer } = input;
  const deviceMac = input.deviceMac ?? null;
  const deviceIp = input.deviceIp ?? null;
  const { uid: userId, email: userEmail } = buyer;

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

  const paymentResult = await verifyPaystackPayment(reference);
  if (!paymentResult.success || !paymentResult.data) {
    return fail(400, "Payment verification failed");
  }
  const paymentData = paymentResult.data;

  if (paymentData.status !== "success") {
    return fail(400, `Payment status is "${paymentData.status}"`);
  }

  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  if (!tenantDoc.exists) return fail(404, "Tenant not found");
  const tenantData = tenantDoc.data()!;

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
  if (!plan) return fail(404, "Plan not found");
  if (!plan.active) return fail(400, "Plan is no longer active");

  const platformConfig = await getPlatformConfig();
  const expectedFee = estimatePaystackFee(
    plan.price,
    platformConfig.paystackFeePassthrough
  );
  if (paymentData.amount !== plan.price + expectedFee) {
    return fail(400, "Payment amount does not match plan price");
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
  if (!location) return fail(404, "Location not found");
  if (!location.active) return fail(400, "Location is no longer active");

  const routerDoc = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .doc(location.routerId)
    .get();
  if (!routerDoc.exists) return fail(404, "Router not found");
  const routerData = routerDoc.data()!;
  if (!routerData.active) return fail(400, "Router is not active");

  // The race guard. Deterministic id, created rather than set: if the other
  // caller beat us here, this throws and we report the work as already done
  // instead of minting a second voucher against one charge.
  const paymentRef = adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .doc(paymentDocId(reference));

  try {
    await paymentRef.create({
      userId,
      userEmail,
      planId,
      planName: plan.name,
      locationId,
      locationName: location.name,
      tenantId,
      amount: paymentData.amount,
      paystackReference: reference,
      status: "success",
      subaccountCode: paymentData.subaccount?.subaccountCode || null,
      // Three genuinely different cases, and collapsing any two of them is
      // how the old code ended up crediting both sides the full amount:
      //   - no subaccount  -> nothing was split, the whole charge settled
      //                       into the platform's own Paystack account
      //   - split reported -> record exactly what Paystack reported
      //   - split missing  -> unknown. Never write a zero for an unknown;
      //                       a zero reads as "earned nothing" forever.
      platformShareKobo: paymentData.subaccount
        ? paymentData.subaccount.platformShareKobo
        : paymentData.amount,
      tenantShareKobo: paymentData.subaccount
        ? paymentData.subaccount.tenantShareKobo
        : 0,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if ((error as { code?: number })?.code === 6) {
      const raced = await adminDb
        .collection(TENANT_COLLECTIONS.payments(tenantId))
        .doc(paymentDocId(reference))
        .get();
      const voucherId = raced.data()?.voucherId;
      return {
        ok: true,
        outcome: "already",
        voucherId,
        ...(await readVoucherCredentials(tenantId, voucherId)),
      };
    }
    throw error;
  }

  // Bookkeeping only, and deliberately after the payment is recorded: the
  // real enforcement of maxCustomers happens before Paystack ever opens.
  const customerRef = adminDb
    .collection(TENANT_COLLECTIONS.customers(tenantId))
    .doc(userId);
  const existingCustomer = await getTenantCustomer(tenantId, userId);

  if (existingCustomer) {
    await customerRef.update({
      totalVouchers: FieldValue.increment(1),
      totalSpent: FieldValue.increment(paymentData.amount),
    });
  } else {
    await customerRef.set({
      uid: userId,
      email: userEmail,
      totalVouchers: 1,
      totalSpent: paymentData.amount,
      joinedAt: FieldValue.serverTimestamp(),
    });

    const tenantPlan = await getBillingPlanById(tenantData.planId);
    const maxCustomers = tenantPlan?.limits.maxCustomers ?? null;
    if (maxCustomers !== null) {
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
    }
  }

  const routerConfig = {
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
  const action = resolveVoucherAction(history, { planId, locationId, now });

  if (action.kind === "extend") {
    const extended = await extendVoucher({
      tenantId,
      routerConfig,
      previous: action.voucher,
      plan,
      now,
      deviceMac,
      deviceIp,
      paymentRef,
      payment: {
        reference,
        amountKobo: paymentData.amount,
        tenantShareKobo: paymentData.subaccount
          ? paymentData.subaccount.tenantShareKobo
          : null,
        hasSubaccount: Boolean(paymentData.subaccount),
      },
      buyer: { uid: userId, email: userEmail },
      locationName: location.name,
    });
    // Null means the credential it meant to extend is no longer on the
    // router, or carries a comment in no format we can safely rewrite.
    // Neither is worth failing a paid purchase over, so it falls through
    // and mints a fresh code the way it always did.
    if (extended) return extended;
  }

  // `action.kind === "unactivated"` deliberately does nothing here. Refusing
  // a purchase is something that happens before Paystack opens
  // (/api/tenant/[slug]/can-purchase); once the money has moved, the rule
  // this codebase holds everywhere is that a payment which already succeeded
  // is never undone by anything downstream. So an unused voucher that got
  // past the pre-check simply produces a second one.
  const credentials = resolveMintCredentials({
    credential: await getVoucherCredential(tenantId, userId),
    history,
    locationId,
    now,
    sameCredentials: plan.sameCredentials ?? true,
  });

  // A customer-chosen username is fixed, so their second purchase at this
  // location finds the user already sitting there from the last one, dead.
  // That is the normal case rather than an edge case, and reusing the record
  // is the only way to keep the name they picked.
  //
  // Reused only if it is ours. The suffix makes a collision with a user the
  // tenant made by hand in Winbox vanishingly unlikely, but "unlikely" is
  // not the standard for overwriting somebody's own router config - so the
  // marker is checked, and anything unrecognised gets a generated code
  // instead of being taken over.
  const found = credentials.custom
    ? (await findHotspotUser(routerConfig, credentials.username)).data ?? null
    : null;
  const reusable = found !== null && isPlatformManaged(found.comment);

  // Standing on somebody else's name is the one outcome worse than not
  // honouring the chosen one, so that case falls all the way back to a
  // random code. Reassigned before anything is written, because the voucher
  // document and the router user have to agree on what the username is.
  if (found !== null && !reusable) {
    const fallback = generateVoucherCredentials(plan.sameCredentials ?? true);
    credentials.username = fallback.username;
    credentials.password = fallback.password;
    credentials.custom = false;
  }

  const mikrotikResult = reusable
    ? await reviveHotspotUser(routerConfig, credentials.username, {
        password: credentials.password,
        profile: plan.mikrotikProfile,
        dataLimit: plan.dataLimit,
      })
    : await createHotspotUser(routerConfig, {
        username: credentials.username,
        password: credentials.password,
        profile: plan.mikrotikProfile,
        comment: "vc",
        dataLimit: plan.dataLimit,
      });

  const voucherRef = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .doc();

  if (!mikrotikResult.success) {
    await voucherRef.set({
      userId,
      userEmail,
      planId,
      planName: plan.name,
      locationId,
      locationName: location.name,
      tenantId,
      username: credentials.username,
      password: credentials.password,
      deviceMac,
      duration: plan.duration,
      dataLimit: plan.dataLimit || null,
      sharedUsers: plan.sharedUsers || null,
      dataLimitBytes: parseDataLimitBytes(plan.dataLimit),
      renewalOf: null,
      status: "failed",
      failureReason: mikrotikResult.error || "Unknown error",
      paystackReference: reference,
      retryCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: null,
    });
    await paymentRef.update({ voucherId: voucherRef.id });

    // Both sides of a failed activation get told. The customer is owed an
    // explanation for money that left their account with nothing to show
    // for it, and the owner would otherwise only find out by happening to
    // open the Failed Queue.
    await notifyVoucherPending({
      tenantId,
      customerEmail: userEmail,
      planName: plan.name,
      locationName: location.name,
      amountKobo: paymentData.amount,
      reference,
    });
    await notifyOwnerVoucherFailed({
      tenantId,
      customerEmail: userEmail,
      planName: plan.name,
      locationName: location.name,
      failureReason: mikrotikResult.error || "Unknown error",
      amountKobo: paymentData.amount,
    });

    return { ok: true, outcome: "pending", voucherId: voucherRef.id };
  }

  // Best-effort: the portal still shows the credentials and a "Get online"
  // button, so a failure here costs one tap rather than the purchase.
  let autoLogin = false;
  if (deviceMac && deviceIp) {
    const login = await loginHotspotMac(routerConfig, {
      mac: deviceMac,
      ip: deviceIp,
      username: credentials.username,
      password: credentials.password,
    });
    autoLogin = login.success;
    if (!login.success) {
      console.warn("Hotspot auto-login failed:", {
        reference,
        deviceMac,
        error: login.error,
      });
    }
  }

  // The auto-login above IS the customer's first login, which is the moment
  // the router's on-login script starts their clock. So this is the one place
  // the expiry can be recorded without guessing: purchase time would be wrong
  // for anyone who buys now and connects later. Otherwise it stays null and
  // the router-health cron reads the real value off the router's comment.
  const expiresAt =
    autoLogin && plan.routerDurationValue
      ? new Date(
          Date.now() +
            plan.routerDurationValue *
              (plan.routerDurationUnit === "d" ? 86400000 : 3600000)
        )
      : null;

  await voucherRef.set({
    userId,
    userEmail,
    planId,
    planName: plan.name,
    locationId,
    locationName: location.name,
    tenantId,
    username: credentials.username,
    password: credentials.password,
    deviceMac,
    duration: plan.duration,
    dataLimit: plan.dataLimit || null,
    sharedUsers: plan.sharedUsers || null,
    dataLimitBytes: parseDataLimitBytes(plan.dataLimit),
    renewalOf: null,
    status: "active",
    paystackReference: reference,
    retryCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  await paymentRef.update({ voucherId: voucherRef.id });

  // The lasting copy of the credentials, and the one the portal buyer needs
  // most: the dialog shows them exactly once. Awaited, not fired and
  // forgotten, because the caller can be torn down the moment it returns.
  await notifyVoucherReady({
    tenantId,
    customerEmail: userEmail,
    planName: plan.name,
    locationName: location.name,
    username: credentials.username,
    password: credentials.password,
    duration: plan.duration,
    dataLimit: plan.dataLimit,
    sharedUsers: plan.sharedUsers,
    amountKobo: paymentData.amount,
    reference,
  });

  // The owner's side of the same event. Deliberately after the customer's
  // email, which is the one that matters: the buyer is waiting on it, and
  // these are awaited in order.
  //
  // `tenantShareKobo` is passed through as-is, null included. Paystack can
  // name a subaccount and report no `fees_split`, and that is unknown rather
  // than zero - telling an owner they earned nothing from a sale they did
  // earn from is worse than telling them nothing.
  await notifyOwnerVoucherSold({
    tenantId,
    customerEmail: userEmail,
    planName: plan.name,
    locationName: location.name,
    amountKobo: paymentData.amount,
    tenantShareKobo: paymentData.subaccount
      ? paymentData.subaccount.tenantShareKobo
      : null,
  });

  return {
    ok: true,
    outcome: "issued",
    voucherId: voucherRef.id,
    username: credentials.username,
    password: credentials.password,
    autoLogin,
  };
}

/**
 * A Paystack reference used as a Firestore document id.
 *
 * References are generated by this app as `hs_<millis>_<suffix>`, which is
 * already id-safe, but a reference that ever arrives from elsewhere must not
 * be able to contain a `/` and address a different path.
 */
function paymentDocId(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150);
}

/**
 * Reads a voucher's credentials back for a caller replaying its own
 * fulfilment. Returns nothing rather than throwing: the payment is already
 * recorded, and failing here must not turn a successful purchase into an
 * error the buyer sees.
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
 * Whether a hotspot user on the router was created by this app.
 *
 * `vc` is the marker written at creation; a parseable expiry date is what
 * the profile's on-login script replaces it with at first login. Anything
 * else - free text, a tenant's note to themselves, nothing at all - is a
 * user somebody made by hand, and this app does not edit those.
 */
function isPlatformManaged(comment: string | undefined): boolean {
  if (!comment) return false;
  if (comment.slice(0, 2).toLowerCase() === "vc") return true;
  return parseRouterExpiryComment(comment) !== null;
}

/**
 * Picks the credentials a newly minted voucher gets.
 *
 * A customer who set a handle at /{tenant}/profile gets the username they
 * chose. Everyone else gets a random code, exactly as before - this feature
 * is opt-in and nothing changes for anyone who ignores it.
 *
 * The one case where a chosen handle is deliberately not used: the customer
 * already has a live voucher at this location. Their handle maps to exactly
 * one RouterOS user, and a live one is carrying a different plan's profile,
 * which is the plan they are still using. Taking it over would downgrade or
 * upgrade a plan they did not ask to change (a RouterOS user has one
 * profile, and the profile is what enforces speed and duration), so the new
 * plan gets its own random code and the one they know keeps running
 * untouched.
 */
function resolveMintCredentials(args: {
  credential: VoucherCredential | null;
  history: Voucher[];
  locationId: string;
  now: Date;
  sameCredentials: boolean;
}): { username: string; password: string; custom: boolean } {
  const { credential, history, locationId, now } = args;

  const occupied = history.some(
    (voucher) =>
      voucher.locationId === locationId &&
      voucher.status === "active" &&
      !voucher.archivedAt &&
      (voucher.expiresAt === null ||
        voucher.expiresAt.getTime() > now.getTime())
  );

  if (credential && !occupied) {
    return {
      username: routerUsernameFor(credential.handle, credential.suffix),
      password: credential.password,
      custom: true,
    };
  }

  return {
    ...generateVoucherCredentials(args.sameCredentials),
    custom: false,
  };
}

/**
 * Tops up a credential the customer is already using, instead of handing
 * them a second one.
 *
 * Returns null when it cannot do that safely, in which case the caller
 * mints a fresh voucher as before. Two reasons for that, both real: the
 * router user may be gone (deleted by hand in Winbox, which tenants do), and
 * its comment may be in a format `formatRouterExpiryComment` does not
 * recognise, which means the router's own script cannot read it either and
 * writing a date into it would expire nobody.
 *
 * ## Why the targets are absolute
 *
 * Both the new expiry and the new byte cap are computed once, written to
 * the voucher document, and only then sent to the router. They are absolute
 * values, never "whatever is there plus the plan". That makes the write
 * idempotent: the retry path, a replay, or an owner re-running a failed
 * renewal from the Failed Queue all send the same two numbers, and the
 * customer cannot be topped up twice for one payment.
 */
async function extendVoucher(args: {
  tenantId: string;
  routerConfig: { ip: string; username: string; password: string };
  previous: Voucher;
  plan: Plan;
  now: Date;
  deviceMac: string | null;
  deviceIp: string | null;
  paymentRef: FirebaseFirestore.DocumentReference;
  payment: {
    reference: string;
    amountKobo: number;
    tenantShareKobo: number | null;
    hasSubaccount: boolean;
  };
  buyer: { uid: string; email: string };
  locationName: string;
}): Promise<FulfilResult | null> {
  const { tenantId, routerConfig, previous, plan, now, paymentRef } = args;

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
  //
  // A comment that does not parse means the router's own script cannot read
  // it either, so there is nothing safe to extend and the caller mints
  // instead.
  const runningUntil = parseRouterExpiryComment(routerUser.comment);
  if (!runningUntil) return null;

  const expiresAt = renewalExpiry(runningUntil, now, plan);
  const comment = formatRouterExpiryComment(expiresAt, routerUser.comment);
  if (!comment) return null;

  const dataLimitBytes = renewalDataLimitBytes(
    parseRouterLimitBytes(routerUser["limit-bytes-total"]),
    plan.dataLimit
  );

  const voucherRef = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .doc();

  const base = {
    userId: args.buyer.uid,
    userEmail: args.buyer.email,
    planId: plan.id,
    planName: plan.name,
    locationId: previous.locationId,
    locationName: args.locationName,
    tenantId,
    username: previous.username,
    password: previous.password,
    // Recorded when the renewal came through the portal, same as a first
    // purchase. It is also what keeps the portal's "welcome back, your plan
    // has ended" card off the screen of someone who just topped up: that
    // card is driven by the newest voucher for the device.
    deviceMac: args.deviceMac,
    duration: plan.duration,
    dataLimit: plan.dataLimit || null,
    sharedUsers: plan.sharedUsers || null,
    dataLimitBytes,
    renewalOf: previous.id,
    paystackReference: args.payment.reference,
    retryCount: 0,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  };

  // The patch RouterOS gets. `limit-uptime` is sent only when the sweeper
  // has already clamped it, which it should not have for a voucher still
  // running - but the sweeper can fire between the read above and this
  // write, and a user left clamped at 1s cannot log in however far into the
  // future their comment says they are good for.
  const patch: Record<string, string> = {
    comment,
    "limit-bytes-total": String(dataLimitBytes ?? 0),
  };
  if (routerUser["limit-uptime"] === "1s") {
    patch["limit-uptime"] = "0";
  }

  const applied = await updateHotspotUser(
    routerConfig,
    previous.username,
    patch
  );

  if (!applied.success) {
    // Same contract as a failed mint: the money stays, the voucher is
    // recorded as failed so it lands in the Failed Queue, and both sides
    // are told. The customer's old plan is untouched and still works, which
    // is worth knowing - this is a top-up that did not land, not an outage.
    await voucherRef.set({
      ...base,
      status: "failed",
      failureReason: applied.error || "Unknown error",
      expiresAt: null,
    });
    await paymentRef.update({ voucherId: voucherRef.id });

    await notifyVoucherPending({
      tenantId,
      customerEmail: args.buyer.email,
      planName: plan.name,
      locationName: args.locationName,
      amountKobo: args.payment.amountKobo,
      reference: args.payment.reference,
    });
    await notifyOwnerVoucherFailed({
      tenantId,
      customerEmail: args.buyer.email,
      planName: plan.name,
      locationName: args.locationName,
      failureReason: applied.error || "Unknown error",
      amountKobo: args.payment.amountKobo,
    });

    return { ok: true, outcome: "pending", voucherId: voucherRef.id };
  }

  await voucherRef.set({ ...base, status: "active" });
  await paymentRef.update({ voucherId: voucherRef.id });

  // The old document stops being the live one. A distinct status rather
  // than an early "expired", because the voucher-expiry cron acts on
  // "active" and would otherwise either email "your access ends in an hour"
  // about a plan that was just topped up, or close it out on a date that no
  // longer applies.
  await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .doc(previous.id)
    .update({
      status: "superseded",
      supersededAt: FieldValue.serverTimestamp(),
      supersededBy: voucherRef.id,
    });

  // Best-effort, exactly as on a first purchase: a renewal bought from the
  // portal is bought from behind the paywall, and the customer's old
  // session may well have dropped even though their voucher had not run
  // out. A failure here costs them one tap on the credentials the dialog is
  // already showing.
  let autoLogin = false;
  if (args.deviceMac && args.deviceIp) {
    const login = await loginHotspotMac(routerConfig, {
      mac: args.deviceMac,
      ip: args.deviceIp,
      username: previous.username,
      password: previous.password,
    });
    autoLogin = login.success;
    if (!login.success) {
      console.warn("Hotspot auto-login failed on renewal:", {
        reference: args.payment.reference,
        deviceMac: args.deviceMac,
        error: login.error,
      });
    }
  }

  await notifyVoucherRenewed({
    tenantId,
    customerEmail: args.buyer.email,
    planName: plan.name,
    locationName: args.locationName,
    username: previous.username,
    password: previous.password,
    duration: plan.duration,
    dataLimit: plan.dataLimit,
    sharedUsers: plan.sharedUsers,
    amountKobo: args.payment.amountKobo,
    reference: args.payment.reference,
    expiresAt,
  });

  await notifyOwnerVoucherSold({
    tenantId,
    customerEmail: args.buyer.email,
    planName: plan.name,
    locationName: args.locationName,
    amountKobo: args.payment.amountKobo,
    tenantShareKobo: args.payment.hasSubaccount
      ? args.payment.tenantShareKobo
      : null,
  });

  return {
    ok: true,
    outcome: "issued",
    voucherId: voucherRef.id,
    username: previous.username,
    password: previous.password,
    autoLogin,
  };
}
