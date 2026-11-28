/**
 * The vocabulary of `paymentReviews`, with no imports, so the superadmin page
 * can use it without pulling server code into the browser bundle.
 *
 * A review is a charge that cleared and that could not be honoured
 * automatically: a voucher sale (lib/voucher-fulfilment.ts) or a billing
 * payment, a plan period, addon, credits or signup (lib/billing-charges.ts).
 * See docs/billing-and-payments.md for why they are recorded at all.
 */

export type PaymentReviewPurpose = "voucher" | "billing";

export type PaymentReviewKind =
  | "tenant_missing"
  | "currency_mismatch"
  | "plan_missing"
  | "plan_inactive"
  | "amount_mismatch"
  | "location_missing"
  | "location_inactive"
  | "router_missing"
  | "router_inactive"
  | "unauthorised_charge"
  | "billing_amount_mismatch"
  | "billing_wrong_account"
  | "billing_tenant_missing"
  | "billing_credits_missing"
  | "billing_addon_missing";

/**
 * A billing review can only be refunded for now: nothing applies a plan period,
 * an addon or credits with a check waived (docs/billing-and-payments.md).
 */
export const BILLING_REVIEW_KINDS: readonly PaymentReviewKind[] = [
  "billing_amount_mismatch",
  "billing_wrong_account",
  "billing_tenant_missing",
  "billing_credits_missing",
  "billing_addon_missing",
];

/**
 * Refusals "fulfil anyway" cannot overrule: the thing a voucher would be
 * issued against no longer exists, or the charge is a billing payment. The
 * only way out is a refund.
 */
export const UNFULFILLABLE_REVIEW_KINDS: readonly PaymentReviewKind[] = [
  "tenant_missing",
  "plan_missing",
  "location_missing",
  "router_missing",
  ...BILLING_REVIEW_KINDS,
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
  unauthorised_charge: "Not started by checkout",
  billing_amount_mismatch: "Billing: amount mismatch",
  billing_wrong_account: "Billing: paid from another account",
  billing_tenant_missing: "Billing: business not found",
  billing_credits_missing: "Billing: no credits named",
  billing_addon_missing: "Billing: addon deleted",
};

export type PaymentReviewResolution = "fulfilled" | "refunded";

/** A review as the superadmin page sees it: dates as ISO strings. */
export interface PaymentReviewView {
  reference: string;
  /** Absent on reviews recorded before billing had them: those are all vouchers. */
  purpose: PaymentReviewPurpose;
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
