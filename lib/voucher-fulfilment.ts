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
  generateVoucherCredentials,
  loginHotspotMac,
} from "@/lib/mikrotik";
import { FieldValue } from "firebase-admin/firestore";
import {
  parsePlan,
  parseLocation,
  getTenantCustomer,
  getTenantCustomerCount,
} from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import {
  notifyLimitApproaching,
  notifyLimitReached,
  notifyOwnerVoucherFailed,
  notifyOwnerVoucherSold,
  notifyPlatformSplitMismatch,
  notifyVoucherPending,
  notifyVoucherReady,
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

  const credentials = generateVoucherCredentials(plan.sameCredentials ?? true);

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

  const mikrotikResult = await createHotspotUser(routerConfig, {
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
