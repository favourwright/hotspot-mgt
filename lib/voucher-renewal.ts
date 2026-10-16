/**
 * Deciding what a repeat purchase should actually do.
 *
 * Before this app existed, the tenant ran vouchers by hand: one router user
 * per customer, and a new subscription meant editing that user's validity
 * rather than creating another one. Automating it reversed that - every
 * purchase minted a fresh random credential and a fresh RouterOS user, and
 * nothing ever removed the old one, so the hotspot user list grew by one per
 * sale forever and most of it was expired.
 *
 * This module puts the old behaviour back where it is correct, and only
 * where it is correct. Two facts about the router decide the whole thing:
 *
 *  1. **Expiry is wall-clock from first login, not from purchase.** The
 *     profile's on-login script stamps `now + duration` into the user's
 *     comment the first time they connect (lib/mikrotik.ts). So a customer
 *     renewing early genuinely has unused days left, and minting a fresh
 *     voucher throws them away.
 *  2. **A RouterOS user has exactly one profile, and the profile is what
 *     carries speed and duration.** Two plans cannot share one credential.
 *     This is not a policy choice, it is the router.
 *
 * Which gives three cases, in `resolveVoucherAction` below.
 *
 * Everything here is pure. The Firestore and router work lives in
 * lib/voucher-fulfilment.ts, and the arithmetic lives here so
 * `npm run test:voucher-renewal` can cover the parts that are easy to get
 * subtly wrong - carrying remaining days over, and carrying remaining data
 * over without ever turning an uncapped plan into a capped one.
 */

import { parseDataLimitBytes } from "@/lib/mikrotik";
import type { Plan, Voucher } from "@/types/schemas";

export type VoucherAction =
  /** No live credential for this plan at this location: mint one, as before. */
  | { kind: "fresh" }
  /**
   * Same plan, same location, already activated and still running. Push the
   * expiry out and top the data up on the credential they already know.
   */
  | { kind: "extend"; voucher: Voucher }
  /**
   * Same plan, same location, bought and never used. There is nothing to
   * extend - the clock has not started, and the on-login script knows only
   * one duration per profile, so two unactivated purchases cannot stack.
   *
   * Used to refuse the sale **before** Paystack opens. It is never acted on
   * after a payment: see the note in lib/voucher-fulfilment.ts.
   */
  | { kind: "unactivated"; voucher: Voucher };

/**
 * Picks the action for a purchase, given everything this customer has ever
 * bought from this tenant.
 *
 * Scoped to plan **and** location. A different plan cannot share a
 * credential at all (fact 2 above), and the same plan at a different
 * location is a different router, so there is nothing there to extend
 * either.
 *
 * `extend` wins over `unactivated` when both somehow exist: the running
 * credential is the one the customer is actually using, and extending it is
 * strictly better for them than being told no.
 */
export function resolveVoucherAction(
  vouchers: Voucher[],
  context: { planId: string; locationId: string; now: Date }
): VoucherAction {
  const candidates = vouchers.filter(
    (voucher) =>
      voucher.planId === context.planId &&
      voucher.locationId === context.locationId &&
      voucher.status === "active" &&
      !voucher.archivedAt
  );

  // The one running furthest into the future, so a customer who somehow
  // holds two gets the longer one extended rather than the older one.
  const activated = candidates
    .filter(
      (voucher) =>
        voucher.expiresAt !== null &&
        voucher.expiresAt.getTime() > context.now.getTime()
    )
    .sort((a, b) => b.expiresAt!.getTime() - a.expiresAt!.getTime())[0];

  if (activated) return { kind: "extend", voucher: activated };

  const unactivated = candidates.find((voucher) => voucher.expiresAt === null);
  if (unactivated) return { kind: "unactivated", voucher: unactivated };

  return { kind: "fresh" };
}

/**
 * Where a renewed voucher's expiry lands.
 *
 * Counted from the **current expiry**, not from now, whenever that is still
 * in the future. That is the entire point of renewing in place: a customer
 * who tops up with two days left gets those two days plus the new plan,
 * exactly as they would have had if they had waited. Counting from now would
 * quietly confiscate the remainder and be indistinguishable, from the
 * outside, from minting a fresh voucher.
 *
 * Falls back to `now` for an expiry already in the past, which the caller
 * should not be passing (that is a `fresh` mint) but which must not produce
 * a date that is still behind the clock if it ever does.
 */
export function renewalExpiry(
  currentExpiresAt: Date | null,
  now: Date,
  plan: Pick<Plan, "routerDurationValue" | "routerDurationUnit">
): Date {
  const base =
    currentExpiresAt && currentExpiresAt.getTime() > now.getTime()
      ? currentExpiresAt
      : now;

  const unitMs = plan.routerDurationUnit === "d" ? 86_400_000 : 3_600_000;
  return new Date(base.getTime() + plan.routerDurationValue * unitMs);
}

/**
 * Where a renewed voucher's `limit-bytes-total` lands.
 *
 * RouterOS measures the user's lifetime counters against this one number, so
 * adding the new plan's allowance to the existing limit is what carries the
 * unused remainder over: whatever they have not spent is still the gap
 * between the counter and the limit.
 *
 * `null` means "no cap", and it is sticky in both directions on purpose:
 *
 *  - uncapped user, capped plan -> stays uncapped. The customer is already
 *    entitled to unlimited data on a credential they are using; imposing a
 *    cap mid-flight would be taking something away in the middle of a top-up.
 *  - capped user, uncapped plan -> becomes uncapped, because that is what
 *    they just bought.
 */
export function renewalDataLimitBytes(
  currentLimitBytes: number | null,
  planDataLimit: string | null | undefined
): number | null {
  if (currentLimitBytes === null) return null;

  const added = parseDataLimitBytes(planDataLimit);
  if (added === null) return null;

  return currentLimitBytes + added;
}

/**
 * Reads `limit-bytes-total` back off a router user.
 *
 * Absent, empty or `0` all mean no cap in RouterOS, and all three come back
 * as `null` here so the caller cannot accidentally treat an uncapped user as
 * one with a zero-byte allowance - which would read as "already exhausted"
 * and cap a customer who had been promised unlimited.
 */
export function parseRouterLimitBytes(
  value: string | null | undefined
): number | null {
  if (!value) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round(bytes);
}
