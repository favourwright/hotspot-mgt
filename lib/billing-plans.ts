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

/** Soft-delete only — never a real Firestore delete, since existing tenants
 * may still reference this plan by id. */
export async function archiveBillingPlan(id: string): Promise<void> {
  await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc(id).update({
    active: false,
    archivedAt: new Date(),
    updatedAt: new Date(),
  });
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
 * monthlyFee — creating or updating it on Paystack as needed. Free/zero-fee
 * plans never need one. Does not persist — caller decides whether/how to save.
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
    // Amount drifted since the plan was created — update it in place.
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
