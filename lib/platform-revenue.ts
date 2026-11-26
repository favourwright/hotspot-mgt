/**
 * The platform revenue ledger: one entry for every payment the platform
 * keeps money from, in `platformRevenue/{id}`. Server only.
 *
 * Revenue reporting reads this one collection instead of summing every
 * place money is recorded (`billingCharges`, credit grants, and later sale
 * commission), so a new way of paying is one new writer rather than an edit
 * to every report. See docs/platform-revenue.md.
 *
 * The rules every writer keeps:
 *
 * - **Written with the record of the money, in the same transaction or
 *   batch.** One is never there without the other. `npm run revenue:reconcile`
 *   compares the two and catches a writer somebody forgot.
 * - **Keyed by what it came from** (`revenueEntryId`), and written with
 *   `set`, not `create`: a re-run writes the same entry again instead of
 *   failing the payment it rides with.
 * - **Never edited.** A refund or correction is a new entry with a negative
 *   amount.
 * - **`amountKobo` is what the platform keeps**, the price. The processing
 *   fee passed on to the payer goes to the gateway and is `feeKobo`, apart.
 */
// Pure: no Firestore here, so the arithmetic is testable without a
// project. Writers build the ref from COLLECTIONS.PLATFORM_REVENUE.

/**
 * What the money was for. A signup is `plan`: it pays the first period, and
 * `kind` keeps the difference for anyone who needs it. `commission` is the
 * platform's share of a voucher sale, written beside the payment document
 * by fulfilment.
 */
export type RevenueSource = "plan" | "addon" | "credits" | "commission";

export interface RevenueEntry {
  source: RevenueSource;
  /** Finer than `source`: `signup` or `plan`, an addon key, `manual` credits. */
  kind: string;
  tenantId: string;
  /** Kobo the platform keeps. Negative for a refund or correction. */
  amountKobo: number;
  /** Processing fee passed on to the payer, kept by the gateway. */
  feeKobo: number;
  /** How it was paid: through Knomad Pay, or off-platform and recorded by hand. */
  method: "knomadpay" | "manual";
  /** The billing charge reference, or the credit ledger entry, it came from. */
  reference: string;
  /** When the money was paid, as near as the writer knows it. */
  occurredAt: Date;
  recordedAt: Date;
}

/** One id per thing paid for, so writing it twice is writing it once. */
export function revenueEntryId(origin: "charge" | "credit-grant" | "sale", reference: string): string {
  if (origin === "charge") return reference;
  return origin === "sale" ? `sale_${reference}` : `credit_${reference}`;
}

/** What a billing charge, once applied, contributes. */
export function chargeRevenue(charge: {
  reference: string;
  kind: "plan" | "addon" | "signup";
  tenantId: string;
  addonKey: string | null;
  priceKobo: number;
  feeKobo: number;
  paidAt: Date;
}): RevenueEntry {
  return {
    source: charge.kind === "addon" ? "addon" : "plan",
    kind: charge.kind === "addon" ? (charge.addonKey ?? "addon") : charge.kind,
    tenantId: charge.tenantId,
    amountKobo: charge.priceKobo,
    feeKobo: charge.feeKobo,
    method: "knomadpay",
    reference: charge.reference,
    occurredAt: charge.paidAt,
    recordedAt: new Date(),
  };
}

/** What a manual credit grant with an amount paid contributes. */
export function creditGrantRevenue(grant: {
  ledgerEntryId: string;
  tenantId: string;
  amountReceivedKobo: number;
  at: Date;
}): RevenueEntry {
  return {
    source: "credits",
    kind: "manual",
    tenantId: grant.tenantId,
    amountKobo: grant.amountReceivedKobo,
    feeKobo: 0,
    method: "manual",
    reference: grant.ledgerEntryId,
    occurredAt: grant.at,
    recordedAt: new Date(),
  };
}

/**
 * The platform's share of a voucher sale, from the same three cases the
 * payment document records (lib/fulfilment-runner.ts, paymentDocument):
 *
 *  - not split: the whole sale was the platform's;
 *  - split reported: exactly the platform's side of it;
 *  - split missing: unknown, and null here. No entry, never a zero: a
 *    zero would read as "earned nothing" forever, and the payment
 *    document leaves `platformShareKobo` null for the same reason.
 */
export function commissionRevenue(sale: {
  reference: string;
  tenantId: string;
  amountKobo: number;
  hasSplit: boolean;
  platformShareKobo: number | null;
  paidAt: Date;
}): RevenueEntry | null {
  const share = sale.hasSplit ? sale.platformShareKobo : sale.amountKobo;
  if (typeof share !== "number") return null;
  return {
    source: "commission",
    kind: sale.hasSplit ? "split" : "unsplit",
    tenantId: sale.tenantId,
    amountKobo: share,
    // The sale's processing fee is inside the split, borne by whichever
    // side the plan says; the share is already net of it.
    feeKobo: 0,
    method: "knomadpay",
    reference: sale.reference,
    occurredAt: sale.paidAt,
    recordedAt: new Date(),
  };
}
