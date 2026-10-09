import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyPaystackPayment } from "@/lib/paystack";
import {
  createHotspotUser,
  generateVoucherCredentials,
  loginHotspotMac,
} from "@/lib/mikrotik";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { resolvePurchaser, handleAuthError } from "@/lib/auth-helpers";
import { FieldValue } from "firebase-admin/firestore";
import { parsePlan, parseLocation, getTenantCustomer, getTenantCustomerCount } from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import {
  notifyLimitApproaching,
  notifyLimitReached,
  notifyOwnerVoucherFailed,
  notifyPlatformSplitMismatch,
  notifyVoucherPending,
  notifyVoucherReady,
} from "@/lib/notifications";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";

const verifySchema = z.object({
  reference: z.string().min(1),
  planId: z.string().min(1),
  locationId: z.string().min(1),
  tenantId: z.string().min(1),
  /**
   * Present only for a purchase made from the captive portal, where the
   * router told us which device is asking. Loosely validated on purpose --
   * it is recorded, never trusted for authorisation.
   */
  deviceMac: z
    .string()
    .regex(/^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/)
    .optional(),
  /**
   * The email a portal guest typed at checkout -- the one Paystack charged.
   * Ignored entirely when the request carries a token: a signed-in buyer's
   * email comes from their account, never from the request body.
   */
  guestEmail: z.string().email().optional(),
  /**
   * The device's address on the hotspot network, from the router's `$(ip)`.
   * Required alongside `deviceMac` to log the device in server-side -- the
   * RouterOS endpoint rejects a login without it.
   */
  deviceIp: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Validate input first: the buyer can only be resolved once we know
    // whether the request carries the guest fields.
    const body = await request.json();
    const validation = verifySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      reference,
      planId,
      locationId,
      tenantId,
      deviceMac,
      deviceIp,
      guestEmail,
    } = validation.data;

    // A signed-in customer, or -- from the captive portal, where creating an
    // account is impossible before you're online -- a guest keyed to their
    // device MAC. Everything below this line treats the two identically;
    // what makes a voucher legitimate is the Paystack reference check, not
    // who asked for it.
    const authHeader = request.headers.get("authorization");
    const purchaser = await resolvePurchaser(authHeader, {
      deviceMac,
      email: guestEmail,
    });
    const userId = purchaser.uid;
    const userEmail = purchaser.email;

    // Check if reference already processed (idempotency)
    const existingPayment = await adminDb
      .collection(TENANT_COLLECTIONS.payments(tenantId))
      .where("paystackReference", "==", reference)
      .limit(1)
      .get();

    if (!existingPayment.empty) {
      const payment = existingPayment.docs[0].data();
      return NextResponse.json({
        success: true,
        data: {
          voucherId: payment.voucherId,
          alreadyProcessed: true,
          // A guest has no account to read the voucher back from, so a
          // retried verify (flaky captive-portal network, a reopened page)
          // has to hand the credentials over again. Scoped to the same
          // buyer: a replayed reference from another device gets nothing.
          ...(purchaser.isGuest && payment.userId === userId
            ? await guestCredentials(tenantId, payment.voucherId)
            : {}),
        },
      });
    }

    // Verify payment with Paystack
    const paymentResult = await verifyPaystackPayment(reference);
    if (!paymentResult.success) {
      return NextResponse.json(
        { success: false, error: "Payment verification failed" },
        { status: 400 }
      );
    }

    const paymentData = paymentResult.data!;

    // Fetch tenant to verify subaccount
    const tenantDoc = await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
    if (!tenantDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const tenantData = tenantDoc.data()!;

    // Verify subaccount was applied if tenant has one
    if (
      tenantData.paystackSubaccountCode &&
      paymentData.subaccount?.subaccountCode !== tenantData.paystackSubaccountCode
    ) {
      // Log the mismatch for admin visibility
      // but do NOT block the payment - the customer
      // already paid and blocking would be worse.
      // Admin can investigate via Paystack dashboard.
      console.warn("Subaccount mismatch on payment:", {
        reference,
        expected: tenantData.paystackSubaccountCode,
        received: paymentData.subaccount?.subaccountCode,
      });
    }

    // Fetch plan
    const planDoc = await adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(planId).get();
    const plan = parsePlan(planDoc);
    
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Verify plan is active
    if (!plan.active) {
      return NextResponse.json(
        { success: false, error: "Plan is no longer active" },
        { status: 400 }
      );
    }

    // Verify price matches (amount is in kobo from Paystack) - may include
    // Paystack's estimated processing fee on top of the plan's own price,
    // same as /api/tenant/[slug]/checkout-amount computed before checkout
    // opened. Recomputed here rather than trusted from the client.
    const platformConfig = await getPlatformConfig();
    const expectedFee = estimatePaystackFee(plan.price, platformConfig.paystackFeePassthrough);
    if (paymentData.amount !== plan.price + expectedFee) {
      return NextResponse.json(
        { success: false, error: "Payment amount does not match plan price" },
        { status: 400 }
      );
    }

    // Same "log, don't block" principle as the subaccount-code check above -
    // if the tenant's actual settled share doesn't match what they were
    // promised (e.g. a tampered transaction_charge), flag it for admin
    // investigation. Never retroactively punish a customer who already paid.
    if (paymentData.subaccount) {
      const expectedTenantShare = Math.round(
        (plan.price * (100 - tenantData.platformFeePercent)) / 100
      );
      const actualTenantShare = paymentData.subaccount.tenantShareKobo;
      if (actualTenantShare === null) {
        // Paystack named the subaccount but reported no `fees_split`. The
        // payment still stands; we just can't record what the split was.
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
        // A console line in production is not a notification - this is money
        // settling somewhere other than where it was promised, and the
        // payment deliberately proceeds anyway, so someone has to be told.
        await notifyPlatformSplitMismatch({
          tenantId,
          reference,
          expectedKobo: expectedTenantShare,
          receivedKobo: actualTenantShare,
          amountKobo: paymentData.amount,
        });
      }
    }

    // Fetch location
    const locationDoc = await adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).doc(locationId).get();
    const location = parseLocation(locationDoc);

    if (!location) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    // Verify location is active
    if (!location.active) {
      return NextResponse.json(
        { success: false, error: "Location is no longer active" },
        { status: 400 }
      );
    }

    // Fetch router credentials via location's routerId
    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(location.routerId)
      .get();

    if (!routerDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    const routerData = routerDoc.data()!;

    // Verify router is active
    if (!routerData.active) {
      return NextResponse.json(
        { success: false, error: "Router is not active" },
        { status: 400 }
      );
    }

    // Generate voucher credentials (using sameCredentials setting from plan)
    const credentials = generateVoucherCredentials(plan.sameCredentials ?? true);

    // Create payment document
    const paymentRef = adminDb.collection(TENANT_COLLECTIONS.payments(tenantId)).doc();
    await paymentRef.set({
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

    // Track this tenant's customer roster. Payment has already succeeded at
    // this point, so this step never blocks anything that follows - it only
    // records bookkeeping and fires a (stubbed) notification if this
    // purchase just crossed the tenant's maxCustomers limit. The actual
    // enforcement (blocking a brand-new customer) happens earlier, in
    // /api/tenant/[slug]/can-purchase, before Paystack ever opens.
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
          // The warning matters more than the notice: once the cap is hit,
          // every brand-new buyer is turned away at /can-purchase before
          // Paystack opens, and the owner has no other signal that it is
          // happening.
          await notifyLimitApproaching(
            tenantId,
            "maxCustomers",
            newCount,
            maxCustomers
          );
        }
      }
    }

    // Attempt to create hotspot user on MikroTik
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
    });

    const voucherRef = adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).doc();

    if (mikrotikResult.success) {
      // Connect the device straight away, so a customer who just paid on the
      // captive portal is online without typing the credentials they were
      // only shown a second ago.
      //
      // Best-effort on purpose: the portal still shows the credentials and a
      // "Get online" button, so a failure here costs one tap rather than the
      // purchase. Never allowed to turn a successful payment into an error.
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

      // Success - create active voucher
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
        deviceMac: deviceMac ?? null,
        duration: plan.duration,
        dataLimit: plan.dataLimit || null,
        status: "active",
        paystackReference: reference,
        retryCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null,
      });

      // Update payment with voucherId
      await paymentRef.update({
        voucherId: voucherRef.id,
      });

      // The lasting copy of the credentials. A guest buyer has no account to
      // look them up under later and the portal shows them exactly once, so
      // for that buyer this email is the only record that survives closing
      // the tab. Awaited, not fired and forgotten: the route can be torn
      // down the moment it returns, which would drop a floating promise.
      await notifyVoucherReady({
        tenantId,
        customerEmail: userEmail,
        planName: plan.name,
        locationName: location.name,
        username: credentials.username,
        password: credentials.password,
        duration: plan.duration,
        dataLimit: plan.dataLimit,
        amountKobo: paymentData.amount,
        reference,
      });

      return NextResponse.json({
        success: true,
        data: {
          voucherId: voucherRef.id,
          // The only moment a guest can ever be told these: they have no
          // account to look them up under later. Safe to return because the
          // caller just proved they hold the Paystack reference these
          // credentials were minted for, moments ago, in this same call.
          ...(purchaser.isGuest
            ? { username: credentials.username, password: credentials.password }
            : {}),
          autoLogin,
        },
      });
    } else {
      // MikroTik failed - create failed voucher for admin retry
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
        deviceMac: deviceMac ?? null,
        duration: plan.duration,
        dataLimit: plan.dataLimit || null,
        status: "failed",
        failureReason: mikrotikResult.error || "Unknown error",
        paystackReference: reference,
        retryCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: null,
      });

      // Update payment with voucherId
      await paymentRef.update({
        voucherId: voucherRef.id,
      });

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

      // Return success with failed flag - payment succeeded, voucher pending
      return NextResponse.json({
        success: true,
        data: { voucherId: voucherRef.id, failed: true },
      });
    }
  } catch (error) {
    console.error("Payment verification error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

/**
 * Reads a voucher's credentials back for a guest replaying their own
 * verify. Returns nothing rather than throwing: the payment is already
 * recorded, and failing here must not turn a successful purchase into an
 * error the buyer sees.
 */
async function guestCredentials(
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
    console.error("Failed to re-read guest voucher credentials:", error);
    return {};
  }
}
