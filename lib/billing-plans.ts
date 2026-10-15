import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import {
  BillingPlan,
  BillingPlanSchema,
  CreateBillingPlanInput,
  UpdateBillingPlanInput,
} from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";
import { createPaystackPlan, updatePaystackPlan } from "@/lib/paystack";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";

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
  const doc = await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).get();
  if (!doc.exists) return null;
  return parseBillingPlanDoc(doc);
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
}

/** Soft-delete - marks inactive, never a real Firestore delete. Used when
 * at least one tenant still references this plan by id. */
export async function archiveBillingPlan(id: string): Promise<void> {
  await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).update({
    active: false,
    archivedAt: new Date(),
    updatedAt: new Date(),
  });
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
}

/**
 * Ensure a plan's cached Paystack Plan code exists and matches its current
 * monthlyFee - creating or updating it on Paystack as needed. Free/zero-fee
 * plans never need one. Does not persist - caller decides whether/how to save.
 */
export async function syncBillingPlanPaystackCode(
  plan: Pick<
    BillingPlan,
    "name" | "monthlyFee" | "paystackPlanCode" | "paystackPlanAmount"
  >
): Promise<{ paystackPlanCode: string | null; paystackPlanAmount: number | null }> {
  if (plan.monthlyFee === 0) {
    return { paystackPlanCode: null, paystackPlanAmount: null };
  }

  if (plan.paystackPlanCode && plan.paystackPlanAmount === plan.monthlyFee) {
    return {
      paystackPlanCode: plan.paystackPlanCode,
      paystackPlanAmount: plan.paystackPlanAmount,
    };
  }

  if (plan.paystackPlanCode) {
    // Amount drifted since the plan was created - update it in place.
    const updated = await updatePaystackPlan(plan.paystackPlanCode, {
      amount: plan.monthlyFee,
    });
    if (updated.success) {
      return {
        paystackPlanCode: plan.paystackPlanCode,
        paystackPlanAmount: plan.monthlyFee,
      };
    }
    console.error(
      `Failed to update Paystack plan ${plan.paystackPlanCode}:`,
      updated.error
    );
    // Fall through and try creating a fresh plan instead.
  }

  const created = await createPaystackPlan({
    name: `${plan.name} - Monthly`,
    amount: plan.monthlyFee,
    interval: "monthly",
  });

  if (!created.success || !created.data) {
    console.error("Failed to create Paystack plan:", created.error);
    return {
      paystackPlanCode: plan.paystackPlanCode ?? null,
      paystackPlanAmount: plan.paystackPlanAmount ?? null,
    };
  }

  return {
    paystackPlanCode: created.data.planCode,
    paystackPlanAmount: plan.monthlyFee,
  };
}

/**
 * Ensure a Paystack Plan code exists for the given billing plan, creating one
 * on demand if needed and persisting it back to the plan doc. Returns null
 * for free/zero-fee plans (no subscription needed). Throws if the plan
 * doesn't exist or can't be prepared for payment.
 */
export async function ensurePlanCodeForBillingPlan(
  planId: string
): Promise<string | null> {
  const plan = await getBillingPlanById(planId);
  if (!plan) {
    throw new Error("Billing plan not found.");
  }
  if (plan.monthlyFee === 0) {
    return null;
  }

  const synced = await syncBillingPlanPaystackCode(plan);

  if (
    synced.paystackPlanCode !== plan.paystackPlanCode ||
    synced.paystackPlanAmount !== plan.paystackPlanAmount
  ) {
    await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(planId).update({
      paystackPlanCode: synced.paystackPlanCode,
      paystackPlanAmount: synced.paystackPlanAmount,
      updatedAt: new Date(),
    });
  }

  if (!synced.paystackPlanCode) {
    throw new Error(
      "Failed to prepare this billing plan for payment. Please try again."
    );
  }

  return synced.paystackPlanCode;
}

/**
 * Same idea as syncBillingPlanPaystackCode, but for the fee-inclusive
 * variant - a completely separate Paystack Plan object (never the one an
 * existing tenant's live Subscription already points at), cached in its own
 * fields. See the schema comment on paystackPlanCodeWithFee for why.
 */
async function syncBillingPlanPaystackCodeWithFee(
  plan: Pick<BillingPlan, "name" | "monthlyFee" | "paystackPlanCodeWithFee" | "paystackPlanAmountWithFee">,
  feeInclusiveAmount: number
): Promise<{ paystackPlanCode: string | null; paystackPlanAmount: number | null }> {
  if (feeInclusiveAmount === 0) {
    return { paystackPlanCode: null, paystackPlanAmount: null };
  }

  if (
    plan.paystackPlanCodeWithFee &&
    plan.paystackPlanAmountWithFee === feeInclusiveAmount
  ) {
    return {
      paystackPlanCode: plan.paystackPlanCodeWithFee,
      paystackPlanAmount: plan.paystackPlanAmountWithFee,
    };
  }

  if (plan.paystackPlanCodeWithFee) {
    // The base price or the platform's fee config changed since this was
    // last synced - update this (fee-inclusive-only) plan in place. Unlike
    // the base paystackPlanCode, nothing yet subscribes to this one at the
    // moment a brand-new onboarding charge runs, so there's no existing
    // subscriber whose amount this could unexpectedly move.
    const updated = await updatePaystackPlan(plan.paystackPlanCodeWithFee, {
      amount: feeInclusiveAmount,
    });
    if (updated.success) {
      return {
        paystackPlanCode: plan.paystackPlanCodeWithFee,
        paystackPlanAmount: feeInclusiveAmount,
      };
    }
    console.error(
      `Failed to update fee-inclusive Paystack plan ${plan.paystackPlanCodeWithFee}:`,
      updated.error
    );
  }

  const created = await createPaystackPlan({
    name: `${plan.name} - Monthly (fee-inclusive)`,
    amount: feeInclusiveAmount,
    interval: "monthly",
  });

  if (!created.success || !created.data) {
    console.error("Failed to create fee-inclusive Paystack plan:", created.error);
    return {
      paystackPlanCode: plan.paystackPlanCodeWithFee ?? null,
      paystackPlanAmount: plan.paystackPlanAmountWithFee ?? null,
    };
  }

  return {
    paystackPlanCode: created.data.planCode,
    paystackPlanAmount: feeInclusiveAmount,
  };
}

/**
 * The onboarding-specific counterpart to ensurePlanCodeForBillingPlan - used
 * for brand-new signups only. Returns the Paystack Plan code to charge
 * against AND the actual amount (base price, plus the estimated Paystack
 * fee if PlatformConfig.paystackFeePassthrough is on) so the caller never
 * has to recompute that itself. When the feature is off, this is identical
 * to calling ensurePlanCodeForBillingPlan directly.
 */
export async function ensureFeeInclusivePlanCodeForBillingPlan(
  planId: string
): Promise<{ planCode: string | null; amount: number }> {
  const plan = await getBillingPlanById(planId);
  if (!plan) {
    throw new Error("Billing plan not found.");
  }

  const config = await getPlatformConfig();
  const fee = estimatePaystackFee(plan.monthlyFee, config.paystackFeePassthrough);

  if (fee === 0) {
    // Feature disabled, or nothing to add (free plan) - no separate
    // fee-inclusive Plan object needed at all.
    const planCode = await ensurePlanCodeForBillingPlan(planId);
    return { planCode, amount: plan.monthlyFee };
  }

  const feeInclusiveAmount = plan.monthlyFee + fee;
  const synced = await syncBillingPlanPaystackCodeWithFee(plan, feeInclusiveAmount);

  if (
    synced.paystackPlanCode !== plan.paystackPlanCodeWithFee ||
    synced.paystackPlanAmount !== plan.paystackPlanAmountWithFee
  ) {
    await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(planId).update({
      paystackPlanCodeWithFee: synced.paystackPlanCode,
      paystackPlanAmountWithFee: synced.paystackPlanAmount,
      updatedAt: new Date(),
    });
  }

  if (!synced.paystackPlanCode) {
    throw new Error(
      "Failed to prepare this billing plan for payment. Please try again."
    );
  }

  return { planCode: synced.paystackPlanCode, amount: feeInclusiveAmount };
}
