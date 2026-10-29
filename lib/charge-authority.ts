/**
 * Whether a successful Paystack charge is one this platform agreed to, and
 * whether it matches what was agreed. Pure, and import-free, so
 * `npm run test:purchase-initiate` covers every case without Firestore.
 *
 * ## Why this exists
 *
 * Until server-side checkout, the browser created the Paystack transaction:
 * it chose the reference, the amount, the split and the metadata naming the
 * tenant, plan and buyer. Fulfilment checked the amount against the plan,
 * but everything else on the charge was the browser's word. Now
 * /api/purchase/initiate creates every voucher transaction and writes a
 * `pendingPurchases` record first, and that record, not the charge, says who
 * bought what for how much.
 *
 * A charge with no record is either a sale started before the switch (still
 * honoured) or one our server never started (sent for review: D3 in
 * docs/plans/tenant-api-and-hooks.md). Which one is decided by when
 * **Paystack** says it was paid, never by the millis inside the reference:
 * the reference used to be chosen by the browser, so a backdated one would
 * walk straight through.
 */

export type ChargeAuthority =
  /** Started by /api/purchase/initiate: the record is the authority. */
  | "pending"
  /** No record, from before the cutover: fulfilled the way it always was. */
  | "legacy"
  /** No record, paid after the cutover: our server never started it. */
  | "unauthorised";

export function chargeAuthority(args: {
  hasPendingRecord: boolean;
  /** Paystack's `paid_at`. */
  paidAt: string | Date | null | undefined;
  /** `PlatformConfig.serverCheckoutRequiredSince`; null means not yet. */
  cutoverAt: Date | null;
}): ChargeAuthority {
  if (args.hasPendingRecord) return "pending";
  if (!args.cutoverAt) return "legacy";

  const paid = args.paidAt ? new Date(args.paidAt) : null;
  // A charge Paystack calls successful with no readable paid time is
  // treated as recent. Guessing "old" is the direction that lets an
  // unauthorised charge through.
  if (!paid || Number.isNaN(paid.getTime())) return "unauthorised";
  return paid.getTime() < args.cutoverAt.getTime() ? "legacy" : "unauthorised";
}

/**
 * How a verified charge differs from the pending record it claims to pay,
 * or null when it matches. The reference matches by construction (the
 * record is looked up by it), so this is amount and currency.
 */
export function pendingMismatch(
  pending: { amountKobo: number; currency: string },
  charge: { amount: number; currency: string }
): { kind: "amount_mismatch" | "currency_mismatch"; detail: string } | null {
  if (charge.currency !== pending.currency) {
    return {
      kind: "currency_mismatch",
      detail: `Charged in ${charge.currency}, checkout was ${pending.currency}`,
    };
  }
  if (charge.amount !== pending.amountKobo) {
    return {
      kind: "amount_mismatch",
      detail: `Charged ${charge.amount} kobo, checkout was ${pending.amountKobo}`,
    };
  }
  return null;
}

/**
 * A server-minted reference: `hs_<millis>_<16 hex>`. Same shape as the
 * browser-made ones it replaces, because paging in lib/transactions.ts
 * splits payment ids on the **first** underscore. Hex, so the suffix itself
 * never contains one.
 */
export function newPurchaseReference(nowMs: number, randomHex: string): string {
  if (!/^[0-9a-f]{16}$/.test(randomHex)) {
    throw new Error("reference suffix must be 16 lowercase hex characters");
  }
  return `hs_${nowMs}_${randomHex}`;
}
