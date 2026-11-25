/**
 * What a signup pays for its first period, from the plan and a promo code.
 *
 * Worked out twice: when the payment is started (/api/onboarding/payment, with the code
 * only checked) and when the tenant is created (create-tenant, with the code redeemed).
 * Both go through `signupPrice`, so the two agree, and create-tenant refuses a payment
 * made for any other price.
 *
 * A code, or the plan's own trial, which needs no code. They do not stack: a code
 * governs outright, and the trial applies only when none was entered. Deliberately not
 * "whichever is better": once a discount can be partial there is no single axis to
 * compare on, and a rule nobody can predict is worse than one that is simply stated.
 * What they are about to pay is on the confirm screen before they pay it.
 */
import { applyFeeDiscount } from "@/lib/coupons";
import type { DiscountType } from "@/types/schemas";

export interface CouponTerms {
  durationDays: number;
  discountType: DiscountType;
  discountValue: number;
}

export interface SignupDiscount {
  days: number;
  discountType: DiscountType;
  discountValue: number;
  source: "coupon" | "trial";
}

export function signupPrice(
  plan: { monthlyFee: number; trialDays?: number | null },
  coupon: CouponTerms | null
): { discount: SignupDiscount | null; discountKobo: number; payableKobo: number } {
  const discount: SignupDiscount | null = coupon
    ? { days: coupon.durationDays, discountType: coupon.discountType, discountValue: coupon.discountValue, source: "coupon" }
    : (plan.trialDays ?? 0) > 0
      ? { days: plan.trialDays!, discountType: "percent", discountValue: 100, source: "trial" }
      : null;
  // A full discount leaves nothing to pay; a partial one makes the first period cheaper
  // (and every period that starts while it lasts: lib/billing-periods.ts).
  const { discountKobo, payableKobo } = discount
    ? applyFeeDiscount(plan.monthlyFee, discount)
    : { discountKobo: 0, payableKobo: plan.monthlyFee };
  return { discount, discountKobo, payableKobo };
}
