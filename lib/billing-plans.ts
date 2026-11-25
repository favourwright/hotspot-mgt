import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import {
  BillingPlan,
  BillingPlanSchema,
  CreateBillingPlanInput,
  UpdateBillingPlanInput,
} from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";
import { getPlatformConfig } from "@/lib/platform-config";
import { createDocCache } from "@/lib/doc-cache";

/**
 * Billing plans are a price list: read on every entitlement check, every
 * checkout and every portal render, written only by the superadmin routes in
 * this same process. That is exactly the shape lib/doc-cache.ts exists for.
 *
 * One captive-portal page render used to read the *same* plan document three
 * times - planGrants, resolvePaystackBearer and the customer-limit check.
 *
 * `null` is cached too. A tenant pointed at a deleted plan would otherwise
 * re-read the miss on every single request, which is the one case where the
 * cache would be doing nothing at all.
 *
 * Every writer below calls invalidateBillingPlan(). A plan edited by a
 * superadmin must be right on the page they land on next, not in five
 * minutes.
 */
const PLAN_CACHE_MS = 5 * 60 * 1000;
const planCache = createDocCache<BillingPlan | null>(PLAN_CACHE_MS);

/**
 * The public price list, as the landing page shows it.
 *
 * Cached as one entry rather than read per request, for the same reason
 * `lib/plans-cache.ts` exists: this is a page nobody has to log in for,
 * so its reads scale with visitors rather than with anybody's clicking,
 * and `getAllBillingPlans` is an uncached collection query that bills a
 * read per plan document every time it runs.
 *
 * Excludes `internal` plans. Those are the ones the company puts its own
 * accounts on, comped through a plan rather than paid for, and a price
 * list is the last place they belong.
 */
const PUBLIC_PLANS_KEY = "public";
const publicPlansCache = createDocCache<BillingPlan[]>(PLAN_CACHE_MS);

export async function getPublicBillingPlans(): Promise<BillingPlan[]> {
  return publicPlansCache.get(PUBLIC_PLANS_KEY, async () => {
    const plans = await getAllBillingPlans({ activeOnly: true });
    return plans.filter((plan) => !plan.internal);
  });
}

export function invalidateBillingPlan(id: string): void {
  planCache.invalidate(id);
  // The list is derived from the same documents, so any write that
  // invalidates one plan invalidates the list it appears in. Every writer
  // already calls this, which is what keeps the public page from showing
  // a price the superadmin has just changed.
  publicPlansCache.invalidate(PUBLIC_PLANS_KEY);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

function parseBillingPlanDoc(
  doc: FirebaseFirestore.DocumentSnapshot
): BillingPlan {
  const data = doc.data()!;
  return BillingPlanSchema.parse({
    id: doc.id,
    ...data,
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? new Date(),
    archivedAt: toDate(data.archivedAt),
  });
}

/**
 * List all billing plans (superadmin management view includes archived
 * ones), ordered for display.
 */
export async function getAllBillingPlans(options?: {
  activeOnly?: boolean;
}): Promise<BillingPlan[]> {
  let query: FirebaseFirestore.Query = adminDb
    .collection(COLLECTIONS.BILLING_PLANS)
    .orderBy("sortOrder", "asc");

  if (options?.activeOnly) {
    query = query.where("active", "==", true);
  }

  const snapshot = await query.get();
  return snapshot.docs.map(parseBillingPlanDoc);
}

/**
 * Who absorbs Paystack's processing fee on a tenant's voucher sales.
 *
 * The tenant's billing plan decides when it says so; otherwise the
 * platform-wide default stands. Both checkout paths resolve it through here
 * so the storefront and the captive portal can never disagree about who is
 * paying, which they would the moment one of them read the plan and the
 * other read the platform config.
 *
 * Falls back to the platform default on a missing or unreadable plan rather
 * than assuming `subaccount`: silently moving Paystack's fee onto a tenant
 * is a charge they did not agree to, so the safe direction is the platform
 * continuing to absorb it.
 */
export async function resolvePaystackBearer(
  planId: string | null | undefined
): Promise<"account" | "subaccount"> {
  const platformConfig = await getPlatformConfig();
  if (!planId) return platformConfig.paystackBearer;

  const plan = await getBillingPlanById(planId);
  return plan?.paystackBearer ?? platformConfig.paystackBearer;
}

export async function getBillingPlanById(
  id: string
): Promise<BillingPlan | null> {
  return planCache.get(id, async () => {
    const doc = await adminDb
      .collection(COLLECTIONS.BILLING_PLANS)
      .doc(id)
      .get();
    if (!doc.exists) return null;
    return parseBillingPlanDoc(doc);
  });
}

export async function createBillingPlan(
  input: CreateBillingPlanInput
): Promise<BillingPlan> {
  const ref = adminDb.collection(COLLECTIONS.BILLING_PLANS).doc();
  const now = new Date();

  await ref.set({
    ...input,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });

  const created = await ref.get();
  return parseBillingPlanDoc(created);
}

export async function updateBillingPlan(
  id: string,
  input: UpdateBillingPlanInput
): Promise<void> {
  await adminDb
    .collection(COLLECTIONS.BILLING_PLANS)
    .doc(id)
    .update({ ...input, updatedAt: new Date() });
  invalidateBillingPlan(id);
}

/** Soft-delete - marks inactive, never a real Firestore delete. Used when
 * at least one tenant still references this plan by id. */
export async function archiveBillingPlan(id: string): Promise<void> {
  await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).update({
    active: false,
    archivedAt: new Date(),
    updatedAt: new Date(),
  });
  invalidateBillingPlan(id);
}

/** How many tenants currently reference this plan - the only thing that
 * decides whether a delete can be permanent or must fall back to archive. */
export async function getTenantCountForPlan(planId: string): Promise<number> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("planId", "==", planId)
    .count()
    .get();
  return snapshot.data().count;
}

/**
 * Delete a billing plan - permanently, if (and only if) no tenant currently
 * references it by id; otherwise falls back to archiving it, since hard-
 * deleting a plan a tenant points to would orphan that tenant's billing
 * record. Returns which outcome actually happened, so the caller can tell
 * the difference.
 */
export async function deleteBillingPlan(
  id: string
): Promise<{ hardDeleted: boolean; tenantCount: number }> {
  const tenantCount = await getTenantCountForPlan(id);

  if (tenantCount === 0) {
    await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).delete();
    invalidateBillingPlan(id);
    return { hardDeleted: true, tenantCount: 0 };
  }

  await archiveBillingPlan(id);
  return { hardDeleted: false, tenantCount };
}

export async function restoreBillingPlan(id: string): Promise<void> {
  await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).update({
    active: true,
    archivedAt: null,
    updatedAt: new Date(),
  });
  invalidateBillingPlan(id);
}

/**
 * The subset of a plan that is safe to hand a browser.
 *
 * No Paystack plan codes, no internal timestamps. Extracted because two
 * places now list plans for someone to choose between - onboarding, and an
 * owner changing their own plan from settings - and a field added to one
 * copy and not the other is a card that renders differently depending on
 * where you opened it from.
 */
export function toPublicBillingPlan(plan: BillingPlan) {
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    billingModel: plan.billingModel,
    monthlyFee: plan.monthlyFee,
    platformFeePercent: plan.platformFeePercent,
    transactionFeeFlat: plan.transactionFeeFlat,
    billingInterval: plan.billingInterval,
    trialDays: plan.trialDays,
    limits: plan.limits,
    features: plan.features,
    // Public: it is what the plan card advertises, nothing more.
    includedAddons: plan.includedAddons ?? [],
    featureList: plan.featureList,
    badge: plan.badge,
    sortOrder: plan.sortOrder,
    contactUrl: plan.contactUrl,
  };
}
