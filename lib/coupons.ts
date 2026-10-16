/**
 * Promo codes, and the one place a redemption is allowed to happen.
 *
 * A coupon waives a new tenant's **plan fee** for a fixed window. It never
 * touches the platform's commission on voucher sales, which is Paystack's
 * subaccount split and not something this app sends per charge.
 *
 * The validation here is advisory and the redemption is authoritative. A
 * caller may ask `validateCoupon` whether a code looks good in order to show
 * something useful in a form, but only `redeemCoupon` decides, inside a
 * transaction, and the signup path must call that rather than trusting
 * anything the browser said about a code.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { Coupon, DiscountType } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Codes are matched case- and whitespace-insensitively, because they are
 * typed by hand off an ad. The normalised form is the document id, so this
 * function is the only definition of what "the same code" means.
 */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function parseCoupon(doc: FirebaseFirestore.DocumentSnapshot): Coupon | null {
  const data = doc.data();
  if (!data) return null;

  return {
    code: doc.id,
    description: data.description ?? "",
    discountType: data.discountType === "amount" ? "amount" : "percent",
    discountValue: data.discountValue ?? 100,
    durationDays: data.durationDays ?? 0,
    maxRedemptions: data.maxRedemptions ?? null,
    timesRedeemed: data.timesRedeemed ?? 0,
    expiresAt: toDate(data.expiresAt),
    active: data.active ?? false,
    createdBy: data.createdBy ?? null,
    createdAt: toDate(data.createdAt) ?? new Date(0),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
}

export async function getCoupon(code: string): Promise<Coupon | null> {
  const doc = await adminDb
    .collection(COLLECTIONS.COUPONS)
    .doc(normalizeCouponCode(code))
    .get();
  return doc.exists ? parseCoupon(doc) : null;
}

export async function listCoupons(): Promise<Coupon[]> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.COUPONS)
    .orderBy("createdAt", "desc")
    .get();
  return snapshot.docs
    .map(parseCoupon)
    .filter((c): c is Coupon => c !== null);
}

/**
 * What a discount takes off a fee, and what is left to pay.
 *
 * Both halves are returned because both get stored: the amount so the waiver
 * records what was actually given against the fee at the time, and the
 * payable so the signup knows whether there is a charge to make at all.
 *
 * Floored at the fee, never negative - a flat discount larger than the fee
 * is a full waiver, not a refund. Rounded rather than truncated so a
 * percentage of an odd kobo amount does not quietly favour one side on
 * every single charge.
 */
export function applyFeeDiscount(
  feeKobo: number,
  discount: { discountType: DiscountType; discountValue: number }
): { discountKobo: number; payableKobo: number } {
  if (feeKobo <= 0) return { discountKobo: 0, payableKobo: 0 };

  const raw =
    discount.discountType === "percent"
      ? Math.round((feeKobo * discount.discountValue) / 100)
      : discount.discountValue;

  const discountKobo = Math.min(Math.max(raw, 0), feeKobo);
  return { discountKobo, payableKobo: feeKobo - discountKobo };
}

export type CouponRejection =
  | "not-found"
  | "inactive"
  | "expired"
  | "fully-redeemed";

export interface CouponCheck {
  valid: boolean;
  reason: CouponRejection | null;
  durationDays: number | null;
  discountType: DiscountType | null;
  discountValue: number | null;
}

/**
 * Whether a code would be accepted right now.
 *
 * Every rejection is reported as the same thing to an anonymous caller (see
 * the validate route): the distinction here exists for the superadmin UI and
 * for logs, not to tell a stranger which codes exist.
 */
export function checkCoupon(
  coupon: Coupon | null,
  now: Date = new Date()
): CouponCheck {
  const no = (reason: CouponRejection): CouponCheck => ({
    valid: false,
    reason,
    durationDays: null,
    discountType: null,
    discountValue: null,
  });

  if (!coupon) return no("not-found");
  if (!coupon.active) return no("inactive");
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime())
    return no("expired");
  if (
    coupon.maxRedemptions !== null &&
    coupon.timesRedeemed >= coupon.maxRedemptions
  )
    return no("fully-redeemed");

  return {
    valid: true,
    reason: null,
    durationDays: coupon.durationDays,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  };
}

export async function validateCoupon(
  code: string,
  now: Date = new Date()
): Promise<CouponCheck> {
  return checkCoupon(await getCoupon(code), now);
}

/**
 * Claim one redemption, or fail.
 *
 * In a transaction, because `maxRedemptions` is otherwise a check-then-act
 * that two simultaneous signups both pass. Everything the caller needs to
 * write the waiver comes back from here, so the duration can never be taken
 * from the request body.
 *
 * Call this **before** the work it authorises, not after. A redemption burnt
 * by a signup that then failed costs one slot on a promo code; redeeming
 * afterwards risks the opposite, a tenant already created with their fee
 * waived and no coupon left to record why.
 */
export async function redeemCoupon(
  code: string,
  now: Date = new Date()
): Promise<
  | {
      ok: true;
      code: string;
      durationDays: number;
      discountType: DiscountType;
      discountValue: number;
    }
  | { ok: false; reason: CouponRejection }
> {
  const ref = adminDb
    .collection(COLLECTIONS.COUPONS)
    .doc(normalizeCouponCode(code));

  return adminDb.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const coupon = doc.exists ? parseCoupon(doc) : null;

    const check = checkCoupon(coupon, now);
    if (!check.valid || !coupon) {
      return { ok: false as const, reason: check.reason ?? "not-found" };
    }

    tx.update(ref, {
      timesRedeemed: coupon.timesRedeemed + 1,
      updatedAt: now,
    });

    return {
      ok: true as const,
      code: coupon.code,
      durationDays: coupon.durationDays,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    };
  });
}
