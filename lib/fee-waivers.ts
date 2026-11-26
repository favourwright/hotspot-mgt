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
 * Scope: the **plan fee only**. The platform's commission on voucher sales is
 * the plan's `platformFeePercent`, which no waiver touches. An account that
 * should also keep 100% of its sales belongs on a plan with
 * `platformFeePercent: 0`.
 */

import { adminDb } from "@/lib/firebase-admin";
import {
  decidePlanFeeStatus,
  quotePlanPeriod,
  type PeriodQuote,
  type PlanFeeStatus,
} from "@/lib/billing-periods";
import { TENANT_COLLECTIONS, COLLECTIONS } from "@/lib/firebase-collections";
import { getBillingPlanById } from "@/lib/billing-plans";
import { getPlatformConfig } from "@/lib/platform-config";
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

export type { PlanFeeStatus } from "@/lib/billing-periods";

/**
 * How long a tenant keeps running after their plan fee falls due, when
 * nothing has been configured.
 *
 * Three days, and it starts from the moment the fee became owed rather than
 * from any email we sent - a grace window that depended on delivery would
 * hand an indefinite extension to anyone whose mail bounced.
 *
 * The live value is `PlatformConfig.planFeeGraceDays`, editable at
 * `/superadmin/config`. This is only the fallback for a platform config
 * document that does not exist yet.
 */
export const DEFAULT_PLAN_FEE_GRACE_DAYS = 3;
export const PLAN_FEE_GRACE_MS =
  DEFAULT_PLAN_FEE_GRACE_DAYS * 24 * 60 * 60 * 1000;

export interface PlanFeeState {
  status: PlanFeeStatus;
  /** The plan's fee for one period, in kobo, before any discount or processing fee. */
  monthlyFee: number;
  /** What a live waiver is taking off that, in kobo. Zero when none is. */
  discountKobo: number;
  planName: string;
  /** When a waiver runs out, so the UI can warn before it does. */
  waiverEndsAt: Date | null;
  /** How far the plan is paid: the tenant's `nextBillingDate`. */
  paidThrough: Date | null;
  /**
   * What paying now would cost and cover, or null when nothing can be paid now: a free
   * plan, a waiver with no end, or a period paid more than a week ahead.
   */
  quote: PeriodQuote | null;
  /**
   * When the fee became owed. Null unless the status is `payment-due`,
   * because nothing else has a debt with a start date.
   */
  dueSince: Date | null;
  /** `dueSince` plus the grace window: when selling stops. Null when not owed. */
  locksAt: Date | null;
  /**
   * Whether the grace window has run out. This is the one field anything
   * outside billing should read - see `lib/billing-lock.ts`.
   */
  locked: boolean;
}

/**
 * Whether this tenant owes their plan fee, and why.
 *
 * Derived, never stored. A waiver closing or a paid period running out writes nothing
 * anywhere - the clock moves and the answer changes - so there is no state to get stuck
 * and no job that has to run on time for a tenant to be billed correctly. The rules
 * themselves are in lib/billing-periods.ts.
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
  const tenant = tenantDoc.data();
  const paidThrough = toDate(tenant?.nextBillingDate);
  const waiver = billing.waiver
    ? { discountKobo: billing.discountKobo, endsAt: billing.waiver.endsAt }
    : null;

  const status = decidePlanFeeStatus({
    planMonthlyFee: billing.planMonthlyFee,
    waiver,
    paidThrough,
    now,
  });
  const quote = quotePlanPeriod({
    now,
    monthlyFee: billing.planMonthlyFee,
    paidThrough,
    waiver,
  });

  // Only read the waiver history for a tenant who actually owes something.
  // Every other status has no debt, so it has no start date either and this
  // would be a collection read for a field nobody looks at.
  let dueSince: Date | null = null;
  let graceMs = PLAN_FEE_GRACE_MS;

  if (status === "payment-due") {
    const [waivers, config] = await Promise.all([
      listFeeWaivers(tenantId),
      getPlatformConfig(),
    ]);
    dueSince = resolvePaymentDueSince({
      waivers,
      nextBillingDate: paidThrough,
      tenantCreatedAt: toDate(tenant?.createdAt),
      now,
    });
    graceMs = config.planFeeGraceDays * 24 * 60 * 60 * 1000;
  }

  const { locked, locksAt } = decidePlanFeeLock({
    status,
    dueSince,
    now,
    graceMs,
  });

  return {
    monthlyFee: billing.planMonthlyFee,
    discountKobo: billing.discountKobo,
    planName: billing.planName,
    waiverEndsAt: billing.waiver?.endsAt ?? null,
    paidThrough,
    quote,
    status,
    dueSince,
    locksAt,
    locked,
  };
}

/**
 * When the current debt started.
 *
 * Derived from the same stored facts the status is, for the same reason: a
 * stored "owing since" would need a job to write it the moment a waiver
 * lapsed, and a job that does not run would hand every affected tenant an
 * unbounded free extension.
 *
 * The latest candidate wins, never the earliest. A tenant whose trial ended
 * in March and who then paid for April is owing from the end of April, not
 * from March - taking the earliest would lock them the instant their
 * subscription lapsed, with no grace at all.
 *
 * Candidates are only considered once they are in the past. A waiver that
 * has not closed yet is not a reason the fee is owed today, and a future
 * billing date means they are paid up.
 */
export function resolvePaymentDueSince(input: {
  waivers: FeeWaiver[];
  nextBillingDate: Date | null;
  tenantCreatedAt: Date | null;
  now: Date;
}): Date {
  const candidates: Date[] = [];

  for (const waiver of input.waivers) {
    // A revoked waiver ended when it was revoked, not when it was going to.
    const ended = waiver.revokedAt ?? waiver.endsAt;
    if (ended) candidates.push(ended);
  }
  if (input.nextBillingDate) candidates.push(input.nextBillingDate);

  const past = candidates.filter((d) => d.getTime() <= input.now.getTime());

  if (past.length > 0) {
    return past.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
  }

  // Never had a waiver and never billed: owing since the account existed.
  // Falling back to `now` instead would restart the window on every request
  // and the tenant would never lock, which is the wrong way to be wrong
  // about a tenant we have no billing history for at all.
  return input.tenantCreatedAt ?? input.now;
}

/**
 * Whether the grace window has run out, kept pure so
 * `npm run test:waivers` can walk the boundary.
 *
 * Only `payment-due` can lock: every other status owes nothing.
 */
export function decidePlanFeeLock(input: {
  status: PlanFeeStatus;
  dueSince: Date | null;
  now: Date;
  graceMs?: number;
}): { locked: boolean; locksAt: Date | null } {
  if (input.status !== "payment-due" || !input.dueSince) {
    return { locked: false, locksAt: null };
  }

  const graceMs = input.graceMs ?? PLAN_FEE_GRACE_MS;
  const locksAt = new Date(input.dueSince.getTime() + graceMs);

  // Inclusive, matching `isWaiverActive`'s treatment of `endsAt`: the moment
  // it arrives, it has arrived.
  return { locked: input.now.getTime() >= locksAt.getTime(), locksAt };
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
