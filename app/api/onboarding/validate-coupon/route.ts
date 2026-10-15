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
import { validateCoupon } from "@/lib/coupons";
import { z } from "zod";

const bodySchema = z.object({
  code: z.string().trim().min(1, "Enter a code").max(32),
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

    return NextResponse.json({
      success: true,
      data: {
        valid: check.valid,
        durationDays: check.durationDays,
        message: check.valid
          ? `Your plan fee is waived for ${check.durationDays} days.`
          : "That code isn't valid.",
      },
    });
  } catch (error) {
    console.error("Validate coupon error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
