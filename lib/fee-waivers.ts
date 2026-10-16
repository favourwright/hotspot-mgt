/**
 * Whether a tenant is currently paying their plan fee.
 *
 * One resolver, in the same spirit as `lib/entitlements.ts`: a waiver is
 * resolved from stored facts at read time rather than migrated onto the
 * tenant document. That is what makes a trial end by itself. Nothing has to
 * run when the window closes, because there is no state to unwind - the
 * waiver simply stops matching the clock.
 *
 * What this never does is change `Tenant.planId`. The plan stays the record
 * of what the tenant chose and agreed to pay; a waiver sits on top of it and
 * expires. Swapping the plan instead would destroy the thing you need in
 * order to put them back.
 *
 * Scope: the **plan fee only**. The platform's commission on voucher sales
 * is enforced by Paystack's subaccount split, not by this app, so no waiver
 * can touch it. An account that should also keep 100% of its sales belongs
 * on a plan with `platformFeePercent: 0` and a matching Paystack subaccount.
 */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS, COLLECTIONS } from "@/lib/firebase-collections";
import { getBillingPlanById } from "@/lib/billing-plans";
import { getTenantDocById } from "@/lib/tenant-cache";
import { DiscountType, FeeWaiver } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function parseWaiver(
  doc: FirebaseFirestore.DocumentSnapshot
): FeeWaiver | null {
  const data = doc.data();
  if (!data) return null;

  const startsAt = toDate(data.startsAt);
  const createdAt = toDate(data.createdAt);
  if (!startsAt || !createdAt) return null;

  return {
    id: doc.id,
    discountType: data.discountType === "amount" ? "amount" : "percent",
    discountValue: data.discountValue ?? 100,
    discountKobo: data.discountKobo ?? 0,
    startsAt,
    endsAt: toDate(data.endsAt),
    source: data.source ?? "manual",
    couponCode: data.couponCode ?? null,
    reason: data.reason ?? "",
    grantedBy: data.grantedBy ?? null,
    revokedAt: toDate(data.revokedAt),
    createdAt,
  };
}

/** Every waiver a tenant has ever had, newest first. */
export async function listFeeWaivers(tenantId: string): Promise<FeeWaiver[]> {
  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.feeWaivers(tenantId))
    .orderBy("createdAt", "desc")
    .get();

  return snapshot.docs
    .map(parseWaiver)
    .filter((w): w is FeeWaiver => w !== null);
}

export function isWaiverActive(waiver: FeeWaiver, now: Date): boolean {
  if (waiver.revokedAt !== null) return false;
  if (waiver.startsAt.getTime() > now.getTime()) return false;
  if (waiver.endsAt !== null && waiver.endsAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

/**
 * The waiver in force right now, or null.
 *
 * If several overlap - which the UI does not create but a coupon on top of a
 * manual comp could - the one ending latest wins, so stacking two can only
 * ever extend the free period rather than cut it short. A waiver with no end
 * date outranks every dated one - nothing creates those any more, but one
 * written before that was settled must not quietly switch off.
 */
export async function getActiveFeeWaiver(
  tenantId: string,
  now: Date = new Date()
): Promise<FeeWaiver | null> {
  const active = (await listFeeWaivers(tenantId)).filter((w) =>
    isWaiverActive(w, now)
  );
  if (active.length === 0) return null;

  return active.reduce((best, candidate) => {
    if (best.endsAt === null) return best;
    if (candidate.endsAt === null) return candidate;
    return candidate.endsAt.getTime() > best.endsAt.getTime() ? candidate : best;
  });
}

export interface EffectiveBilling {
  planId: string;
  planName: string;
  /** What the plan says, before any discount. */
  planMonthlyFee: number;
  /** What they actually owe right now, in kobo. */
  effectiveMonthlyFee: number;
  /** How much a live waiver is taking off, in kobo. Zero when none is. */
  discountKobo: number;
  /**
   * Untouched by waivers, always. Here so a caller sees the whole picture
   * in one object rather than reading the tenant document separately and
   * assuming a waiver covered this too.
   */
  platformFeePercent: number;
  waiver: FeeWaiver | null;
}

/**
 * What a tenant owes, and why.
 *
 * Reads the fee from the live billing plan rather than the snapshot on the
 * tenant document, because a waiver is about what they pay *now*. The
 * snapshot still governs real charges, so these can differ for a tenant
 * whose plan was edited after signup - that is the documented snapshot
 * behaviour, not drift.
 */
export async function getEffectiveBilling(
  tenantId: string,
  now: Date = new Date()
): Promise<EffectiveBilling | null> {
  // Shared with the notification preferences and the entitlement check,
  // which read the same document while rendering the same page.
  const tenant = await getTenantDocById(tenantId);
  if (!tenant) return null;

  const plan = tenant.planId ? await getBillingPlanById(tenant.planId) : null;
  const waiver = await getActiveFeeWaiver(tenantId, now);
  const planMonthlyFee = plan?.monthlyFee ?? tenant.monthlyFee ?? 0;

  // The amount recorded on the waiver, not a fresh calculation: the plan's
  // price can have changed since, and what this tenant was given is a fact
  // about then rather than now. Floored, so a stale discount larger than a
  // reduced fee cannot produce a negative.
  const discountKobo = waiver
    ? Math.min(waiver.discountKobo, planMonthlyFee)
    : 0;

  return {
    planId: tenant.planId ?? "",
    planName: plan?.name ?? tenant.planName ?? "",
    planMonthlyFee,
    effectiveMonthlyFee: planMonthlyFee - discountKobo,
    discountKobo,
    platformFeePercent: tenant.platformFeePercent ?? 0,
    waiver,
  };
}

export type PlanFeeStatus =
  | "no-fee"
  | "waived"
  | "subscribed"
  | "past-due"
  | "payment-due";

export interface PlanFeeState {
  status: PlanFeeStatus;
  /** Kobo the tenant would pay to start or resume, before Paystack's fee. */
  monthlyFee: number;
  /** What a live waiver is taking off that, in kobo. Zero when none is. */
  discountKobo: number;
  planName: string;
  /** When a waiver runs out, so the UI can warn before it does. */
  waiverEndsAt: Date | null;
  subscriptionStatus: string | null;
}

/**
 * Whether this tenant owes their plan fee, and why.
 *
 * Derived, never stored. A waiver closing does not write anything anywhere -
 * the clock moves and the answer changes - so there is no state to get stuck
 * and no job that has to run on time for a tenant to be billed correctly.
 *
 * `past-due` is deliberately separate from `payment-due`. Paystack is
 * already retrying a card in that case and will resolve it on its own;
 * asking the tenant to pay again would take a second payment for the same
 * period.
 */
export async function getPlanFeeState(
  tenantId: string,
  now: Date = new Date()
): Promise<PlanFeeState | null> {
  const billing = await getEffectiveBilling(tenantId, now);
  if (!billing) return null;

  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  const subscriptionStatus = tenantDoc.data()?.subscriptionStatus ?? null;

  return {
    monthlyFee: billing.planMonthlyFee,
    discountKobo: billing.discountKobo,
    planName: billing.planName,
    waiverEndsAt: billing.waiver?.endsAt ?? null,
    subscriptionStatus,
    status: decidePlanFeeStatus({
      planMonthlyFee: billing.planMonthlyFee,
      hasActiveWaiver: billing.waiver !== null,
      subscriptionStatus,
    }),
  };
}

/**
 * The decision itself, separated from the reads so it can be exercised
 * without Firestore. Order matters and is not arbitrary:
 *
 *  1. No fee beats everything. A tenant on a free plan is never asked for
 *     money, whatever their subscription field happens to say.
 *  2. A waiver beats an unpaid subscription, so a comped tenant is not
 *     chased for a fee they do not owe.
 *  3. `past_due` is **not** "payment due". Paystack is already retrying a
 *     card and will resolve it on its own; prompting the tenant as well
 *     would take a second payment for the same period.
 */
export function decidePlanFeeStatus(input: {
  planMonthlyFee: number;
  hasActiveWaiver: boolean;
  subscriptionStatus: string | null;
}): PlanFeeStatus {
  if (input.planMonthlyFee === 0) return "no-fee";
  if (input.hasActiveWaiver) return "waived";
  if (input.subscriptionStatus === "active") return "subscribed";
  if (input.subscriptionStatus === "past_due") return "past-due";

  // Null (never subscribed, or a waiver that has now closed) or "cancelled".
  return "payment-due";
}

/**
 * Every tenant with a waiver in force right now.
 *
 * One collection-group read rather than one query per tenant: the superadmin
 * billing page needs this for every tenant at once, and this codebase has
 * already exhausted a daily read quota by doing the per-row version of
 * exactly this.
 *
 * No `where` clause on purpose. The collection is small, the filtering is
 * the same clock comparison `isWaiverActive` makes, and keeping it in memory
 * means no composite index to create and no query that can silently return
 * nothing because an index is still building.
 */
export async function getActiveWaiversByTenant(
  now: Date = new Date()
): Promise<Record<string, { discountType: DiscountType; discountValue: number }>> {
  const snapshot = await adminDb.collectionGroup("feeWaivers").get();
  const out: Record<
    string,
    { discountType: DiscountType; discountValue: number }
  > = {};

  for (const doc of snapshot.docs) {
    const tenantId = doc.ref.parent.parent?.id;
    if (!tenantId) continue;

    const waiver = parseWaiver(doc);
    if (!waiver || !isWaiverActive(waiver, now)) continue;

    out[tenantId] = {
      discountType: waiver.discountType,
      discountValue: waiver.discountValue,
    };
  }

  return out;
}
