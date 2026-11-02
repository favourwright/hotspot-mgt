/**
 * What `BillingPlan.limits.maxCustomers` measures: customers who have paid
 * this tenant in the last 30 days.
 *
 * It used to count everyone who had ever paid. The fee is monthly and a
 * hotspot's customers are often passers-by, so a lifetime count filled up with
 * people who were never coming back and could never go down again.
 *
 * The window is derived at read time from `TenantCustomer.lastPurchaseAt`, so
 * a seat frees itself with no job to run. A document with no `lastPurchaseAt`
 * has not bought since the field was introduced and does not count.
 *
 * Holds no Firestore import, so client components can share the wording and
 * `npm run test:active-customers` can run it without credentials.
 */

export const ACTIVE_CUSTOMER_WINDOW_DAYS = 30;

const WINDOW_MS = ACTIVE_CUSTOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** How a customer limit reads on a plan card, after the number. */
export const ACTIVE_CUSTOMER_LIMIT_NOUN = "active customers a month";

/** The oldest purchase that still counts. A purchase at exactly this moment does. */
export function activeCustomerWindowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_MS);
}

export function isActiveCustomer(
  lastPurchaseAt: Date | null | undefined,
  now: Date
): boolean {
  if (!lastPurchaseAt) return false;
  return lastPurchaseAt.getTime() >= activeCustomerWindowStart(now).getTime();
}
