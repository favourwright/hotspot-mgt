import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import {
  createPaystackSubaccount,
  createPaystackCustomer,
  verifyPaystackPayment,
} from "@/lib/paystack";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { CreateTenantSchema } from "@/types/schemas";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { syncUserClaims } from "@/lib/auth-claims-admin";
import { invalidateTenant } from "@/lib/tenant-cache";
import { FieldValue } from "firebase-admin/firestore";
import { getBillingPlanById } from "@/lib/billing-plans";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import { notifyOwnerWelcome, notifyPlatformNewTenant } from "@/lib/notifications";
import { redeemCoupon } from "@/lib/coupons";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);

    // Prevent creating multiple tenants
    if (verifiedUser.role === "owner") {
      return NextResponse.json(
        { success: false, error: "You already have a tenant account" },
        { status: 400 }
      );
    }

    if (verifiedUser.role === "superadmin") {
      return NextResponse.json(
        { success: false, error: "Superadmin cannot create a tenant" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const validation = CreateTenantSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const {
      businessName,
      slug,
      planId,
      accountNumber,
      bankCode,
      bankName,
      accountName,
      paystackReference,
      couponCode,
    } = validation.data;

    // Check slug availability
    const slugAvailable = await isSlugAvailable(slug);
    if (!slugAvailable) {
      return NextResponse.json(
        { success: false, error: "This slug is already taken" },
        { status: 400 }
      );
    }

    // Get the selected billing plan - could have been archived while the
    // user had onboarding open, so re-validate it's still selectable.
    const plan = await getBillingPlanById(planId);
    if (!plan || !plan.active) {
      return NextResponse.json(
        { success: false, error: "This billing plan is no longer available. Please choose another." },
        { status: 400 }
      );
    }

    // Custom/"contact us" plans have no price to charge and are never
    // self-serve selectable in the UI - reject here too, since the UI alone
    // is never the real enforcement (nothing stops a direct API call).
    if (plan.billingModel === "custom") {
      return NextResponse.json(
        { success: false, error: "This plan requires contacting sales - it can't be selected through self-serve signup." },
        { status: 400 }
      );
    }

    // A promo code waives the plan fee, which means skipping the charge
    // below. Redeemed here, before the Paystack calls, because this is the
    // point where the decision not to charge is made: claiming the slot
    // afterwards risks a tenant created free with no coupon left to record
    // why. The cost of this ordering is that a signup which fails further
    // down burns one redemption, which is the cheaper mistake.
    //
    // Nothing from the request decides this. The duration comes back from
    // the transaction that claimed it.
    let redeemedCoupon: { code: string; durationDays: number } | null = null;

    if (couponCode) {
      const redemption = await redeemCoupon(couponCode);
      if (!redemption.ok) {
        return NextResponse.json(
          { success: false, error: "That promo code isn't valid." },
          { status: 400 }
        );
      }
      redeemedCoupon = {
        code: redemption.code,
        durationDays: redemption.durationDays,
      };
    }

    // The plan's own trial, which needs no code. Resolved alongside the
    // coupon because both produce the same thing: a window with the plan fee
    // waived.
    //
    // They do not stack. The longer window wins, so entering a code can
    // never leave someone worse off than not entering one - which would be
    // the behaviour nobody could explain afterwards. A coupon entered when
    // the trial is longer is still redeemed: they chose to use it, and
    // silently not spending it would make the redemption count a lie.
    const couponDays = redeemedCoupon?.durationDays ?? 0;
    const trialDays = plan.trialDays ?? 0;
    const waivedDays = Math.max(couponDays, trialDays);
    const waiverSource: "coupon" | "trial" =
      couponDays >= trialDays && couponDays > 0 ? "coupon" : "trial";

    // Paid tiers require proof of a successful first-month payment before
    // the tenant account is created/activated. A waived fee - from a coupon
    // or the plan's trial - means there is nothing to charge and nothing to
    // verify.
    let subscriptionStatus: "active" | null = null;
    let nextBillingDate: Date | null = null;

    if (plan.monthlyFee > 0 && waivedDays === 0) {
      if (!paystackReference) {
        return NextResponse.json(
          {
            success: false,
            error: "Payment is required to activate this billing plan.",
          },
          { status: 400 }
        );
      }

      const paymentResult = await verifyPaystackPayment(paystackReference);

      if (!paymentResult.success || !paymentResult.data) {
        return NextResponse.json(
          {
            success: false,
            error: paymentResult.error || "Payment verification failed.",
          },
          { status: 400 }
        );
      }

      // The client may have been charged the plan's price plus an estimated
      // Paystack processing fee on top (see lib/paystack-fees.ts) - recompute
      // that expected total ourselves rather than trust anything the client
      // asserts, same as the price check it replaces.
      const platformConfig = await getPlatformConfig();
      const expectedFee = estimatePaystackFee(
        plan.monthlyFee,
        platformConfig.paystackFeePassthrough
      );
      if (paymentResult.data.amount !== plan.monthlyFee + expectedFee) {
        return NextResponse.json(
          { success: false, error: "Payment amount does not match the selected plan." },
          { status: 400 }
        );
      }

      if (
        paymentResult.data.customerEmail.toLowerCase() !==
        verifiedUser.email.toLowerCase()
      ) {
        return NextResponse.json(
          { success: false, error: "Payment does not belong to this account." },
          { status: 400 }
        );
      }

      subscriptionStatus = "active";
      nextBillingDate = new Date();
      nextBillingDate.setDate(nextBillingDate.getDate() + 30);
    }

    // Create Paystack customer for owner
    const customerResult = await createPaystackCustomer({
      email: verifiedUser.email,
    });

    if (!customerResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create billing account: ${customerResult.error}`,
        },
        { status: 500 }
      );
    }

    // Create Paystack subaccount for revenue split
    const subaccountResult = await createPaystackSubaccount({
      businessName,
      bankCode,
      accountNumber,
      percentageCharge: plan.platformFeePercent,
    });

    if (!subaccountResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create payment account: ${subaccountResult.error}`,
        },
        { status: 500 }
      );
    }

    // Create tenant document in Firestore.
    //
    // Batched with the waiver when there is one: a tenant created with its
    // fee waived and no waiver document would be free forever, with nothing
    // recording why. The two have to land together or not at all.
    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc();
    const batch = adminDb.batch();
    batch.set(tenantRef, {
      slug,
      businessName,
      ownerUid: verifiedUser.uid,
      ownerEmail: verifiedUser.email,
      status: "active",
      planId: plan.id,
      planName: plan.name,
      platformFeePercent: plan.platformFeePercent,
      monthlyFee: plan.monthlyFee,
      paystackCustomerCode: customerResult.data!.customerCode,
      paystackSubscriptionCode: null, // populated by the subscription.create webhook
      subscriptionStatus,
      nextBillingDate,
      paystackSubaccountCode: subaccountResult.data!.subaccountCode,
      bankName,
      accountNumber,
      accountName,
      wireguardPublicKey: null,
      wireguardTunnelIp: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (waivedDays > 0) {
      const startsAt = new Date();
      const endsAt = new Date(startsAt);
      endsAt.setDate(endsAt.getDate() + waivedDays);

      batch.set(
        adminDb.collection(TENANT_COLLECTIONS.feeWaivers(tenantRef.id)).doc(),
        {
          startsAt,
          endsAt,
          source: waiverSource,
          // Recorded even when the plan's trial is what set the length, so
          // the redemption on the coupon has something to point at.
          couponCode: redeemedCoupon?.code ?? null,
          reason:
            waiverSource === "coupon"
              ? `Code ${redeemedCoupon?.code} redeemed at signup for ${waivedDays} days`
              : `${plan.name} includes a ${waivedDays} day trial`,
          grantedBy: null,
          revokedAt: null,
          createdAt: startsAt,
        }
      );
    }

    await batch.commit();

    // Upgrade user to owner role and set tenantId
    await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(verifiedUser.uid)
      .update({
        role: "owner",
        tenantId: tenantRef.id,
        updatedAt: FieldValue.serverTimestamp(),
      });

    // The caller must refreshSession() after this returns - the role change
    // only reaches the server once a new token (and session cookie) carries
    // these claims.
    await syncUserClaims(verifiedUser.uid, "owner", tenantRef.id);

    // If anyone hit /{slug} before this moment, "no such tenant" is cached
    // against it. Clear that so the new portal is reachable immediately.
    invalidateTenant(slug);

    // Everything above has already succeeded and been charged for - these are
    // the last thing to happen and are never allowed to fail the signup.
    await notifyOwnerWelcome({
      tenantId: tenantRef.id,
      ownerEmail: verifiedUser.email,
      businessName,
      slug,
      planName: plan.name,
      // What they will actually be billed right now. Telling a tenant on a
      // waived plan that they owe the full fee would be the welcome email
      // contradicting their own dashboard.
      monthlyFeeKobo: waivedDays > 0 ? 0 : plan.monthlyFee,
    });

    await notifyPlatformNewTenant({
      businessName,
      slug,
      ownerEmail: verifiedUser.email,
      planName: plan.name,
      monthlyFeeKobo: plan.monthlyFee,
    });

    return NextResponse.json({
      success: true,
      data: {
        tenantId: tenantRef.id,
        slug,
        planId: plan.id,
        requiresSubscriptionPayment: plan.monthlyFee > 0 && waivedDays === 0,
        monthlyFee: plan.monthlyFee,
        couponApplied: redeemedCoupon?.code ?? null,
        feeWaivedDays: waivedDays > 0 ? waivedDays : null,
      },
    });
  } catch (error) {
    console.error("Create tenant error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
