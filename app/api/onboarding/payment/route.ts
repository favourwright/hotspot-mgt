/**
 * POST /api/onboarding/payment: starts the first period's payment for a signup on a
 * paid plan, before the tenant exists. Returns Monnify's checkout (through Knomad Pay),
 * shown in a frame on the confirm step; once paid, the browser sends the reference to
 * create-tenant, which checks it and claims it in the batch that creates the tenant
 * (lib/billing-charges.ts, prepareSignupClaim).
 *
 * The price is worked out here from the plan and the code (only checked here; redeemed
 * by create-tenant), never sent by the browser, by the same function create-tenant uses
 * (lib/signup-price.ts). The slug is checked first, so a taken slug is found before
 * anyone pays rather than after.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { COUPON_CHECK_LIMIT, validateCoupon } from "@/lib/coupons";
import { rateLimit } from "@/lib/rate-limit";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { signupPrice } from "@/lib/signup-price";
import { startBillingCharge } from "@/lib/billing-charges";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  planId: z.string().min(1),
  slug: z.string().min(1),
  couponCode: z.string().trim().max(32).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await verifyAuthenticated(request.headers.get("authorization"));
    if (user.role === "owner" || user.role === "superadmin") {
      return NextResponse.json({ success: false, error: "This account cannot sign up a business." }, { status: 400 });
    }
    const validation = bodySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error.issues[0].message }, { status: 400 });
    }
    const { planId, slug, couponCode } = validation.data;

    if (!(await isSlugAvailable(slug))) {
      return NextResponse.json({ success: false, error: "This slug is already taken" }, { status: 400 });
    }
    const plan = await getBillingPlanById(planId);
    if (!plan || !plan.active || plan.billingModel === "custom") {
      return NextResponse.json(
        { success: false, error: "This billing plan is no longer available. Please choose another." },
        { status: 400 }
      );
    }

    let coupon = null;
    if (couponCode) {
      // Shared with every route that answers whether a code is valid.
      if (!rateLimit(`coupon-check:${user.uid}`, COUPON_CHECK_LIMIT).ok) {
        return NextResponse.json(
          { success: false, error: "Too many attempts. Wait a few minutes and try again." },
          { status: 429 }
        );
      }
      const check = await validateCoupon(couponCode);
      if (!check.valid || check.discountType === null) {
        return NextResponse.json({ success: false, error: "That promo code isn't valid." }, { status: 400 });
      }
      coupon = {
        durationDays: check.durationDays ?? 0,
        discountType: check.discountType,
        discountValue: check.discountValue ?? 0,
      };
    }
    const { payableKobo } = signupPrice(plan, coupon);
    if (payableKobo <= 0) {
      return NextResponse.json({ success: false, error: "This plan needs no payment to start." }, { status: 409 });
    }

    const started = await startBillingCharge({
      kind: "signup",
      tenantId: null,
      uid: user.uid,
      email: user.email,
      planId: plan.id,
      priceKobo: payableKobo,
      couponCode: couponCode ?? null,
      description: `${plan.name} plan, first month`,
    });
    if (!started.ok) {
      return NextResponse.json({ success: false, error: started.error }, { status: started.status });
    }
    return NextResponse.json({
      success: true,
      data: { reference: started.reference, checkoutUrl: started.checkoutUrl, amount: started.amountKobo },
    });
  } catch (error) {
    console.error("Onboarding payment error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
