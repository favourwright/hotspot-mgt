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
import { formatNaira } from "@/lib/utils";
import type { DiscountType } from "@/types/schemas";
import { applyFeeDiscount, redeemCoupon } from "@/lib/coupons";
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
    let redeemedCoupon: {
      code: string;
      durationDays: number;
      discountType: DiscountType;
      discountValue: number;
    } | null = null;

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
        discountType: redemption.discountType,
        discountValue: redemption.discountValue,
      };
    }

    // A code, or the plan's own trial, which needs no code. They do not
    // stack: a redeemed code governs outright, and the trial applies only
    // when none was entered.
    //
    // Deliberately not "whichever is better". Once a discount can be partial
    // there is no single axis to compare on - a longer window at 20% against
    // a shorter one at 100% has no answer that holds for every plan - and a
    // rule nobody can predict is worse than one that is simply stated. What
    // they are about to pay is on the confirm screen before they pay it.
    const discount = redeemedCoupon
      ? {
          days: redeemedCoupon.durationDays,
          discountType: redeemedCoupon.discountType,
          discountValue: redeemedCoupon.discountValue,
          source: "coupon" as const,
        }
      : (plan.trialDays ?? 0) > 0
        ? {
            days: plan.trialDays,
            discountType: "percent" as DiscountType,
            discountValue: 100,
            source: "trial" as const,
          }
        : null;

    // What the signup actually has to collect, computed here and never taken
    // from the request. A full discount leaves nothing to charge; a partial
    // one leaves a reduced amount, charged once rather than subscribed to -
    // Paystack cannot subscribe at one price and take another.
    const { discountKobo, payableKobo } = discount
      ? applyFeeDiscount(plan.monthlyFee, discount)
      : { discountKobo: 0, payableKobo: plan.monthlyFee };

    // Computed once, before anything uses it: the waiver document and the
    // welcome email have to name the same date, and deriving it twice is how
    // they end up a second apart.
    const discountStartsAt = new Date();
    const discountEndsAt =
      discount && discountKobo > 0
        ? new Date(
            discountStartsAt.getTime() + discount.days * 24 * 60 * 60 * 1000
          )
        : null;

    // Paid tiers require proof of payment before the tenant account is
    // created. `subscriptionStatus` stays null unless the charge was against
    // the Paystack Plan: a discounted one-off establishes no subscription,
    // so claiming one would leave a tenant we believe is subscribed and
    // Paystack has never heard of.
    let subscriptionStatus: "active" | null = null;
    let nextBillingDate: Date | null = null;

    if (payableKobo > 0) {
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
        payableKobo,
        platformConfig.paystackFeePassthrough
      );
      if (paymentResult.data.amount !== payableKobo + expectedFee) {
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

      // Only a full-price charge goes through the Paystack Plan and so
      // creates a subscription. A discounted one is a one-off, and the
      // tenant is asked for full price when the window closes - which is
      // the payment that actually subscribes them.
      if (discountKobo === 0) {
        subscriptionStatus = "active";
        nextBillingDate = new Date();
        nextBillingDate.setDate(nextBillingDate.getDate() + 30);
      }
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

    if (discount && discountKobo > 0 && discountEndsAt) {
      const startsAt = discountStartsAt;
      const endsAt = discountEndsAt;

      const label =
        discount.discountType === "percent"
          ? `${discount.discountValue}%`
          : formatNaira(discount.discountValue);

      batch.set(
        adminDb.collection(TENANT_COLLECTIONS.feeWaivers(tenantRef.id)).doc(),
        {
          startsAt,
          endsAt,
          source: discount.source,
          couponCode: redeemedCoupon?.code ?? null,
          discountType: discount.discountType,
          discountValue: discount.discountValue,
          // The resolved sum, against the fee as it stands today. Stored
          // rather than recomputed, because the plan's price can change and
          // this has to keep answering what this tenant was given.
          discountKobo,
          reason:
            discount.source === "coupon"
              ? `Code ${redeemedCoupon?.code} redeemed at signup: ${label} off for ${discount.days} days`
              : `${plan.name} includes a ${discount.days} day trial`,
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
      // The plan's real price, always. What they actually paid and why is
      // said in words alongside it - putting the discounted figure under
      // "Monthly fee" is what made this read as though a 3,000 naira plan
      // cost nothing.
      monthlyFeeKobo: plan.monthlyFee,
      discountKobo,
      discountEndsAt,
      couponCode: redeemedCoupon?.code ?? null,
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
        requiresSubscriptionPayment: payableKobo > 0,
        monthlyFee: plan.monthlyFee,
        couponApplied: redeemedCoupon?.code ?? null,
        discountKobo,
        feeWaivedDays: discount?.days ?? null,
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
