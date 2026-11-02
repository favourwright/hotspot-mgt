/**
 * What moving to a different billing plan would cost a tenant in capability.
 *
 * ## Why this exists at all
 *
 * A tenant whose plan fee has lapsed has two ways out, not one: pay the fee,
 * or move to a plan they can actually afford. Without the second, the only
 * option for somebody short of money this month is to stop paying - which
 * loses the account rather than the difference between two tiers.
 *
 * But a cheaper plan has smaller limits, and a tenant already over them is
 * the normal case rather than the edge one: that is usually *why* they are
 * on the larger plan. So a downgrade cannot simply be refused (that puts
 * them back to "pay or leave") and cannot silently proceed either.
 *
 * ## What "frozen" means, and what it does not
 *
 * Limits in this codebase are enforced at **creation** time -
 * `maxCustomers` in the portal's can-purchase check, routers and locations
 * when they are added. Nothing walks the existing rows and deletes the
 * excess, and nothing here asks it to.
 *
 * So a tenant who downgrades below their usage keeps everything they have.
 * What they lose is the ability to add more of it until they are back under
 * the cap. Their third router keeps serving customers; they just cannot
 * register a fourth. That is a far smaller consequence than "you will lose a
 * router", and the warning has to say the true version, because the
 * frightening one would stop people taking the cheaper plan that keeps their
 * account alive.
 *
 * `maxCustomers` is the one with a sharper edge: it is checked before a
 * *sale*, so a tenant over that cap stops being able to take on new
 * customers. Existing ones keep buying - `can-purchase` lets a known
 * customer through regardless - but the business stops growing until they
 * move back up or enough customers go 30 days without buying. That is worth
 * naming explicitly rather than lumping in with the others.
 */

import { ACTIVE_CUSTOMER_WINDOW_DAYS } from "@/lib/active-customers";
import type { BillingPlan } from "@/types/schemas";

export interface TenantUsage {
  routers: number;
  locations: number;
  customers: number;
}

export interface PlanLimitBreach {
  /** Which cap, as the field name, so the UI can order them consistently. */
  limit: "maxRouters" | "maxLocations" | "maxCustomers";
  /** How many they have now. */
  current: number;
  /** What the plan being moved to allows. */
  allowed: number;
  /** One sentence, in the second person, naming the real consequence. */
  consequence: string;
}

/**
 * Every cap the tenant is already over on the plan they are moving to.
 *
 * Empty for an upgrade, for a sideways move, and for a downgrade by someone
 * who is comfortably inside the smaller limits - which is why the dialog can
 * show a plain confirm in the common case and only escalate when this comes
 * back non-empty.
 *
 * A `null` limit is unlimited, never zero. Reading it as zero would report
 * every unlimited plan as a breach of everything, which is exactly backwards.
 */
export function describePlanDowngrade(
  usage: TenantUsage,
  target: BillingPlan
): PlanLimitBreach[] {
  const checks: Array<{
    limit: PlanLimitBreach["limit"];
    current: number;
    allowed: number | null;
    consequence: (allowed: number) => string;
  }> = [
    {
      limit: "maxRouters",
      current: usage.routers,
      allowed: target.limits.maxRouters,
      consequence: (allowed) =>
        `Your routers keep running. You won't be able to register another until you're down to ${allowed}.`,
    },
    {
      limit: "maxLocations",
      current: usage.locations,
      allowed: target.limits.maxLocations,
      consequence: (allowed) =>
        `Your locations keep running. You won't be able to add another until you're down to ${allowed}.`,
    },
    {
      limit: "maxCustomers",
      current: usage.customers,
      allowed: target.limits.maxCustomers,
      consequence: (allowed) =>
        `Customers you already have keep buying as normal. New customers won't be able to buy until fewer than ${allowed} have bought in the last ${ACTIVE_CUSTOMER_WINDOW_DAYS} days.`,
    },
  ];

  const breaches: PlanLimitBreach[] = [];

  for (const check of checks) {
    if (check.allowed === null) continue;
    if (check.current <= check.allowed) continue;
    breaches.push({
      limit: check.limit,
      current: check.current,
      allowed: check.allowed,
      consequence: check.consequence(check.allowed),
    });
  }

  return breaches;
}

/**
 * What a plan change has to do to the Paystack subscription.
 *
 * Paystack bills from its own subscription object, which is tied to one
 * Paystack Plan and cannot be moved to another. Changing only our record leaves
 * the card being charged the old fee, so the old subscription has to stop, and
 * a new one has to start where the paid period ends. Nothing is prorated: the
 * period already paid for stands, and the new fee starts at the next charge.
 */
export type SubscriptionMove =
  | { action: "none" }
  | { action: "stop" }
  | { action: "reschedule"; startDate: Date };

/** Whether Paystack could still charge this tenant for their current plan. */
export function hasLivePlatformSubscription(tenant: {
  subscriptionStatus?: string | null;
  paystackSubscriptionCode?: string | null;
}): boolean {
  return (
    Boolean(tenant.paystackSubscriptionCode) &&
    (tenant.subscriptionStatus === "active" ||
      tenant.subscriptionStatus === "past_due")
  );
}

/**
 * A `past_due` subscription gets no new one: there is no paid period to honour,
 * so its start date would be a guess, and the owner pays the new fee instead.
 * The same goes for an active one with no future payment date.
 */
export function decideSubscriptionMove(input: {
  subscriptionStatus: string | null;
  /** Paystack's own status, which outranks ours: a webhook may be in flight. */
  paystackStatus: string;
  nextPaymentDate: Date | null;
  newMonthlyFee: number;
  now: Date;
}): SubscriptionMove {
  if (input.paystackStatus !== "active" && input.paystackStatus !== "attention") {
    return { action: "none" };
  }
  if (input.newMonthlyFee === 0) return { action: "stop" };
  if (input.subscriptionStatus === "past_due") return { action: "stop" };
  if (
    input.nextPaymentDate &&
    input.nextPaymentDate.getTime() > input.now.getTime()
  ) {
    return { action: "reschedule", startDate: input.nextPaymentDate };
  }
  return { action: "stop" };
}

/**
 * Whether a webhook event is about a subscription this tenant no longer uses.
 *
 * Replacing a subscription makes Paystack report the old one as disabled, and
 * that must not read as the tenant cancelling. The marker covers the moment
 * before the new code is recorded; the comparison covers everything after.
 */
export function isStalePlatformSubscriptionEvent(input: {
  eventCode: string | null;
  recordedCode: string | null;
  supersededCode: string | null;
}): boolean {
  if (!input.eventCode) return false;
  if (input.supersededCode === input.eventCode) return true;
  return Boolean(input.recordedCode) && input.recordedCode !== input.eventCode;
}
