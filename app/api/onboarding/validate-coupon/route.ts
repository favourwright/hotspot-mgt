/**
 * Does this promo code work? Asked by the onboarding form so it can show
 * something useful before the user commits.
 *
 * Advisory only. Nothing here reserves anything, and `create-tenant`
 * re-validates and redeems the code itself inside a transaction - so a
 * caller skipping this endpoint, or lying about what it returned, gains
 * nothing.
 *
 * Authenticated, because onboarding already is by this point, and an
 * anonymous endpoint that reports whether an arbitrary string is a valid
 * code is a free oracle for guessing them.
 *
 * Every rejection returns the same message. Telling a caller the difference
 * between "no such code" and "that code is used up" is the same oracle in a
 * politer form.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { applyFeeDiscount, validateCoupon } from "@/lib/coupons";
import { getBillingPlanById } from "@/lib/billing-plans";
import { formatNaira } from "@/lib/utils";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import { z } from "zod";

const bodySchema = z.object({
  code: z.string().trim().min(1, "Enter a code").max(32),
  /** So the reply can say what this code leaves them paying. */
  planId: z.string().min(1, "A plan is required"),
});

export async function POST(request: NextRequest) {
  try {
    await verifyAuthenticated(request.headers.get("authorization"));

    const validation = bodySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const check = await validateCoupon(validation.data.code);

    if (!check.valid || check.discountType === null) {
      return NextResponse.json({
        success: true,
        data: { valid: false, message: "That code isn't valid." },
      });
    }

    const plan = await getBillingPlanById(validation.data.planId);
    const fee = plan?.monthlyFee ?? 0;
    const { discountKobo, payableKobo } = applyFeeDiscount(fee, {
      discountType: check.discountType,
      discountValue: check.discountValue ?? 0,
    });

    // The exact sum to hand Paystack, fee included, computed against the
    // DISCOUNTED amount - which is what create-tenant will expect. Doing
    // this on the client would mean subtracting a fee calculated on the full
    // price, and the two only agree while passthrough is off.
    const platformConfig = await getPlatformConfig();
    const chargeKobo =
      payableKobo > 0
        ? payableKobo +
          estimatePaystackFee(payableKobo, platformConfig.paystackFeePassthrough)
        : 0;

    // The figure the button is about to show, computed here so the browser
    // never works out its own price. create-tenant recomputes it again
    // before accepting the payment.
    const message =
      fee === 0
        ? "This plan has no fee, so this code changes nothing."
        : payableKobo === 0
          ? `Your plan fee is waived for ${check.durationDays} days.`
          : `${formatNaira(discountKobo)} off your first payment, then full price after ${check.durationDays} days.`;

    return NextResponse.json({
      success: true,
      data: {
        valid: true,
        durationDays: check.durationDays,
        discountKobo,
        payableKobo,
        chargeKobo,
        message,
      },
    });
  } catch (error) {
    console.error("Validate coupon error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
