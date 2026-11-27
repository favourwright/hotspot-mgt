import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { CreateTenantSchema } from "@/types/schemas";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { syncUserClaims } from "@/lib/auth-claims-admin";
import { invalidateTenant } from "@/lib/tenant-cache";
import { FieldValue } from "firebase-admin/firestore";
import { getBillingPlanById } from "@/lib/billing-plans";
import { notifyOwnerWelcome, notifyPlatformNewTenant } from "@/lib/notifications";
import { formatNaira } from "@/lib/utils";
import { redeemCoupon, validateCoupon } from "@/lib/coupons";
import { signupPrice, type CouponTerms } from "@/lib/signup-price";
import { prepareSignupClaim } from "@/lib/billing-charges";
import { PLAN_INTERVAL_MS } from "@/lib/billing-periods";
import { ensureTenantPayee } from "@/lib/knomad-pay-payees";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { rateLimit } from "@/lib/rate-limit";
import { COUPON_CHECK_LIMIT } from "@/lib/coupons";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);

    // Prevent creating multiple tenants. The role comes from the token,
    // which may predate a signup made a moment ago (a second tab, a retried
    // request), so the user document is asked too, and the batch below
    // reserves the uid so two requests in flight cannot both get through.
    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(verifiedUser.uid).get();
    if (verifiedUser.role === "owner" || userDoc.get("tenantId")) {
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
      paymentReference,
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

    // What the first period costs: from the plan and the code, checked here and redeemed
    // below, by the same function the payment was started with (lib/signup-price.ts).
    let couponTerms: CouponTerms | null = null;
    if (couponCode) {
      // The same limit as /api/onboarding/validate-coupon and on the same
      // key: what this route answers about a code is the same oracle.
      if (!rateLimit(`coupon-check:${verifiedUser.uid}`, COUPON_CHECK_LIMIT).ok) {
        return NextResponse.json(
          { success: false, error: "Too many attempts. Wait a few minutes and try again." },
          { status: 429 }
        );
      }
      const check = await validateCoupon(couponCode);
      if (!check.valid || check.discountType === null) {
        return NextResponse.json(
          { success: false, error: "That promo code isn't valid." },
          { status: 400 }
        );
      }
      couponTerms = {
        durationDays: check.durationDays ?? 0,
        discountType: check.discountType,
        discountValue: check.discountValue ?? 0,
      };
    }
    const { discount, discountKobo, payableKobo } = signupPrice(plan, couponTerms);

    // A paid plan needs its first period paid before the tenant exists: a payment of
    // this user's, for this plan at this price, not used yet. Checked before the code is
    // redeemed, so a signup that fails here does not use up a promo slot.
    let claim: Awaited<ReturnType<typeof prepareSignupClaim>> | null = null;
    if (payableKobo > 0) {
      if (!paymentReference) {
        return NextResponse.json(
          { success: false, error: "Payment is required to activate this billing plan." },
          { status: 400 }
        );
      }
      claim = await prepareSignupClaim({
        reference: paymentReference,
        uid: verifiedUser.uid,
        planId: plan.id,
        priceKobo: payableKobo,
      });
      if (!claim.ok) {
        return NextResponse.json({ success: false, error: claim.error }, { status: claim.status });
      }
    }

    // Redeemed now, in a transaction, because `maxRedemptions` is otherwise a
    // check-then-act two simultaneous signups both pass.
    let redeemedCode: string | null = null;
    if (couponCode) {
      const redemption = await redeemCoupon(couponCode);
      if (redemption.ok) {
        redeemedCode = redemption.code;
      } else if (payableKobo === 0) {
        return NextResponse.json(
          { success: false, error: "That promo code isn't valid." },
          { status: 400 }
        );
      } else {
        // Paid for at the discounted price while the last slot went to someone else.
        // The period they paid for stands; the discount is not recorded beyond it.
        console.warn(`[signup] ${couponCode} ran out after ${verifiedUser.uid} paid with it`);
      }
    }
    // A waiver is recorded for the plan's trial, or a code actually redeemed.
    const waiverDiscount =
      discount && discountKobo > 0 && (discount.source === "trial" || redeemedCode) ? discount : null;

    // Computed once, before anything uses it: the waiver document and the
    // welcome email have to name the same date, and deriving it twice is how
    // they end up a second apart.
    const discountStartsAt = new Date();
    const discountEndsAt = waiverDiscount
      ? new Date(discountStartsAt.getTime() + waiverDiscount.days * 24 * 60 * 60 * 1000)
      : null;

    // A first period paid for runs from now. Nothing renews by itself: the next one is
    // paid from the dashboard (lib/billing-charges.ts).
    const paidPeriod =
      payableKobo > 0
        ? { from: discountStartsAt, to: new Date(discountStartsAt.getTime() + PLAN_INTERVAL_MS) }
        : null;

    // Create tenant document in Firestore.
    //
    // Batched with the waiver when there is one: a tenant created with its
    // fee waived and no waiver document would be free forever, with nothing
    // recording why. The two have to land together or not at all.
    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc();
    const batch = adminDb.batch();
    // Both fail the whole batch if they already exist: one tenant per
    // account, one tenant per slug, whatever arrived at the same moment.
    // The checks above stay as the readable refusal, and cover tenants made
    // before these reservations existed.
    batch.create(adminDb.collection(COLLECTIONS.TENANT_OWNERS).doc(verifiedUser.uid), {
      tenantId: tenantRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.create(adminDb.collection(COLLECTIONS.TENANT_SLUGS).doc(slug), {
      tenantId: tenantRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
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
      nextBillingDate: paidPeriod?.to ?? null,
      // Every new tenant takes payments through Knomad Pay. Its payee (the tenant's
      // sub-account for their share of each sale) is made just after this, from these
      // bank details; until it exists, sales are refused rather than paid into Knomad's
      // own account (app/api/purchase/initiate).
      paymentGateway: "knomadpay",
      knomadPayeeReference: null,
      bankCode,
      bankName,
      accountNumber,
      accountName,
      wireguardPublicKey: null,
      wireguardTunnelIp: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (claim?.ok && paidPeriod) claim.claim(batch, tenantRef.id, paidPeriod);
    if (waiverDiscount && discountEndsAt) {
      const discount = waiverDiscount;
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
          couponCode: redeemedCode ?? null,
          discountType: discount.discountType,
          discountValue: discount.discountValue,
          // The resolved sum, against the fee as it stands today. Stored
          // rather than recomputed, because the plan's price can change and
          // this has to keep answering what this tenant was given.
          discountKobo,
          reason:
            discount.source === "coupon"
              ? `Code ${redeemedCode} redeemed at signup: ${label} off for ${discount.days} days`
              : `${plan.name} includes a ${discount.days} day trial`,
          grantedBy: null,
          revokedAt: null,
          createdAt: startsAt,
        }
      );
    }

    try {
      await batch.commit();
    } catch (error) {
      // 6 is ALREADY_EXISTS: a reservation above was taken first.
      if ((error as { code?: number }).code === 6) {
        return NextResponse.json(
          {
            success: false,
            error: "This slug was just taken, or your account already has a business. Refresh and try again.",
          },
          { status: 409 }
        );
      }
      throw error;
    }

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

    // The tenant's payee at Knomad Pay, so their sales can be split to them. Best effort:
    // a signup is never failed over it. Anything not made now (Monnify unreachable, or a
    // bank it cannot match) is made by the reconcile cron, or by
    // scripts/knomad-pay-payees.mts once someone has looked.
    try {
      const payee = await ensureTenantPayee({
        id: tenantRef.id,
        businessName,
        ownerEmail: verifiedUser.email,
        bankName,
        bankCode,
        accountNumber,
        accountName,
        knomadPayeeReference: null,
      });
      if (payee.kind !== "ready") console.warn(`[signup] no payee yet for ${slug}: ${payee.kind}`);
    } catch (error) {
      console.error(`[signup] payee for ${slug} failed:`, error);
    }
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
      couponCode: redeemedCode ?? null,
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
        paidThrough: paidPeriod?.to.toISOString() ?? null,
        monthlyFee: plan.monthlyFee,
        couponApplied: redeemedCode ?? null,
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
