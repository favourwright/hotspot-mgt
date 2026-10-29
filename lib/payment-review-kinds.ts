/**
 * The vocabulary of `paymentReviews`, with no imports, so the superadmin page
 * can use it without pulling server code into the browser bundle.
 *
 * A review is a charge that cleared and that fulfilment could not honour
 * automatically. See lib/voucher-fulfilment.ts for where each kind comes
 * from and docs/billing-and-payments.md for why they are recorded at all.
 */

export type PaymentReviewKind =
  | "tenant_missing"
  | "currency_mismatch"
  | "plan_missing"
  | "plan_inactive"
  | "amount_mismatch"
  | "location_missing"
  | "location_inactive"
  | "router_missing"
  | "router_inactive";

/**
 * Refusals "fulfil anyway" cannot overrule: the thing a voucher would be
 * issued against no longer exists. The only way out is a refund.
 */
export const UNFULFILLABLE_REVIEW_KINDS: readonly PaymentReviewKind[] = [
  "tenant_missing",
  "plan_missing",
  "location_missing",
  "router_missing",
];

export const REVIEW_KIND_LABELS: Record<PaymentReviewKind, string> = {
  tenant_missing: "Business not found",
  currency_mismatch: "Wrong currency",
  plan_missing: "Plan deleted",
  plan_inactive: "Plan switched off",
  amount_mismatch: "Amount mismatch",
  location_missing: "Location deleted",
  location_inactive: "Location switched off",
  router_missing: "Router deleted",
  router_inactive: "Router switched off",
};

export type PaymentReviewResolution = "fulfilled" | "refunded";

/** A review as the superadmin page sees it: dates as ISO strings. */
export interface PaymentReviewView {
  reference: string;
  tenantId: string;
  businessName: string | null;
  kind: PaymentReviewKind;
  detail: string;
  amountKobo: number;
  currency: string;
  chargedEmail: string;
  /** Absent on reviews recorded before these fields existed. */
  buyerUid: string | null;
  planId: string | null;
  locationId: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  resolution: PaymentReviewResolution | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  voucherId: string | null;
}
