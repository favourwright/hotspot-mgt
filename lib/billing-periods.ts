/**
 * What a payment to the platform buys, kept pure so `npm run test:billing-periods` can
 * walk every edge without Firestore.
 *
 * Billing is one-off payments, one period at a time (docs/billing-and-payments.md, D4 in
 * knomad-pay's plan): nothing renews by itself, so there is no subscription to cancel,
 * no card being retried, and no second payment Paystack might take for the same month.
 * A tenant's plan is paid up to `nextBillingDate`; an addon is paid up to its
 * entitlement's `currentPeriodEnd`. A payment extends that date by one interval.
 *
 * Every payment buys a whole period, never less: whatever it is paid ahead of, it starts
 * where the time already paid for (or given free) ends, so a payment made early loses no
 * days, and one made twice by accident buys a second period rather than nothing.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** One plan period. The 30 days the rest of the app has always used. */
export const PLAN_INTERVAL_MS = 30 * DAY_MS;

/** How long before a paid period ends the next one can be paid for. */
export const RENEW_WINDOW_MS = 7 * DAY_MS;

export function addonIntervalMs(interval: "monthly" | "yearly"): number {
  return (interval === "yearly" ? 365 : 30) * DAY_MS;
}

export type PlanFeeStatus = "no-fee" | "waived" | "paid" | "payment-due";

/** A live fee waiver, as far as these rules care. */
export interface LiveWaiver {
  /** What it takes off the fee, in kobo. At or above the fee, it waives all of it. */
  discountKobo: number;
  /** Null for a waiver that never ends. */
  endsAt: Date | null;
}

const latest = (...dates: (Date | null | undefined)[]): Date =>
  new Date(Math.max(...dates.filter((d): d is Date => d instanceof Date).map((d) => d.getTime())));

function waivesAll(fee: number, waiver: LiveWaiver | null): boolean {
  return waiver !== null && waiver.discountKobo >= fee;
}

/**
 * Whether this tenant owes their plan fee, in this order:
 *
 *  1. No fee beats everything.
 *  2. A waiver of the whole fee: nothing is owed while it lasts. A partial discount is
 *     not this; it lowers what each period costs (see `quotePlanPeriod`).
 *  3. Paid up: `paidThrough` is still ahead.
 *  4. Otherwise the fee is owed, and the grace window runs (`decidePlanFeeLock`).
 */
export function decidePlanFeeStatus(input: {
  planMonthlyFee: number;
  waiver: LiveWaiver | null;
  paidThrough: Date | null;
  now: Date;
}): PlanFeeStatus {
  if (input.planMonthlyFee <= 0) return "no-fee";
  if (waivesAll(input.planMonthlyFee, input.waiver)) return "waived";
  if (input.paidThrough && input.paidThrough.getTime() > input.now.getTime()) return "paid";
  return "payment-due";
}

export interface PeriodQuote {
  amountKobo: number;
  /** What a live partial discount took off the plan fee. */
  discountKobo: number;
  from: Date;
  to: Date;
}

/**
 * What paying the plan fee now would cost and cover, or null when nothing can be paid.
 *
 * The period starts at the latest of: now, the end of the time already paid for, and
 * the end of a waiver of the whole fee. So paying during a free trial buys the month
 * after it, and paying before a paid month ends buys the next one.
 *
 * It can be paid when the fee is owed; during a free period that has an end, once; and
 * within `RENEW_WINDOW_MS` of the paid time running out. Further ahead than that it is
 * refused, which keeps a stray second click from buying months nobody meant to.
 *
 * A partial discount applies to a period that starts while it is still live, so "20% off
 * for 90 days" makes three cheaper months.
 */
export function quotePlanPeriod(input: {
  now: Date;
  monthlyFee: number;
  paidThrough: Date | null;
  waiver: LiveWaiver | null;
  renewWindowMs?: number;
}): PeriodQuote | null {
  const { now, monthlyFee, paidThrough, waiver } = input;
  if (monthlyFee <= 0) return null;
  const full = waivesAll(monthlyFee, waiver);
  if (full && waiver!.endsAt === null) return null; // comped for good: nothing to pay, ever

  const freeUntil = full ? waiver!.endsAt : null;
  const from = latest(now, paidThrough, freeUntil);
  // Measured from when paying would otherwise first be needed: now, or the end of the
  // free period. Only the time already paid beyond that counts against the window.
  const earliest = latest(now, freeUntil);
  if (from.getTime() - earliest.getTime() > (input.renewWindowMs ?? RENEW_WINDOW_MS)) return null;

  const discountLive =
    !full && waiver !== null && (waiver.endsAt === null || waiver.endsAt.getTime() > from.getTime());
  const discountKobo = discountLive ? Math.min(waiver!.discountKobo, monthlyFee) : 0;
  const amountKobo = monthlyFee - discountKobo;
  if (amountKobo <= 0) return null;
  return { amountKobo, discountKobo, from, to: new Date(from.getTime() + PLAN_INTERVAL_MS) };
}

/**
 * What paying for an addon now would cover, or null when it is paid far enough ahead.
 * The same rule as the plan: it starts where the paid time ends, or now if that has
 * passed (time spent in the grace window after a lapse is not charged for).
 */
export function quoteAddonPeriod(input: {
  now: Date;
  paidThrough: Date | null;
  interval: "monthly" | "yearly";
  renewWindowMs?: number;
}): { from: Date; to: Date } | null {
  const from = latest(input.now, input.paidThrough);
  if (from.getTime() - input.now.getTime() > (input.renewWindowMs ?? RENEW_WINDOW_MS)) return null;
  return { from, to: new Date(from.getTime() + addonIntervalMs(input.interval)) };
}
