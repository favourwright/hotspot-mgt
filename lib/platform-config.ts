import { cache } from "react";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import {
  PlatformConfig,
  PlatformConfigSchema,
  DEFAULT_BILLING_PLAN_CONFIG,
  BillingPlanConfigItem,
  TenantBillingPlan,
} from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";
import { createPaystackPlan, updatePaystackPlan } from "@/lib/paystack";

const PLATFORM_CONFIG_DOC = "config";

/**
 * Default platform config used when Firestore
 * document does not exist yet.
 */
const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  billingPlans: DEFAULT_BILLING_PLAN_CONFIG,
  paystackBearer: "account",
  wireguard: {
    serverPublicKey: "",
    serverEndpoint: "",
    tunnelSubnet: "10.10.0.0/16",
  },
};

/**
 * Fetch platform config from Firestore.
 * Falls back to DEFAULT_PLATFORM_CONFIG if the
 * document does not exist yet.
 * Cached per request using React cache().
 */
export const getPlatformConfig = cache(
  async (): Promise<PlatformConfig> => {
    try {
      const doc = await adminDb
        .collection(COLLECTIONS.PLATFORM)
        .doc(PLATFORM_CONFIG_DOC)
        .get();

      if (!doc.exists) {
        // Document doesn't exist yet — use defaults
        // and create the document for next time
        await setPlatformConfig(DEFAULT_PLATFORM_CONFIG);
        return DEFAULT_PLATFORM_CONFIG;
      }

      const data = doc.data()!;

      // Convert Firestore Timestamp to Date
      if (data.updatedAt instanceof Timestamp) {
        data.updatedAt = data.updatedAt.toDate();
      }

      return PlatformConfigSchema.parse(data);
    } catch (error) {
      console.error(
        "Failed to fetch platform config, using defaults:",
        error
      );
      return DEFAULT_PLATFORM_CONFIG;
    }
  }
);

/**
 * Update platform config in Firestore.
 * Called by superadmin API routes only.
 */
export async function setPlatformConfig(
  config: Omit<PlatformConfig, "updatedAt">
): Promise<void> {
  await adminDb
    .collection(COLLECTIONS.PLATFORM)
    .doc(PLATFORM_CONFIG_DOC)
    .set(
      {
        ...config,
        updatedAt: new Date(),
      },
      { merge: true }
    );
}

/**
 * Get billing plan config for a specific plan.
 * Falls back to default if plan not found.
 */
export async function getBillingPlanConfig(
  plan: keyof PlatformConfig["billingPlans"]
) {
  const config = await getPlatformConfig();
  return config.billingPlans[plan] || DEFAULT_BILLING_PLAN_CONFIG[plan];
}

/**
 * Ensure a billing tier's cached Paystack Plan (paystackPlanCode) exists and
 * matches the tier's current monthlyFee — creating or updating it on Paystack
 * as needed. Free tiers (monthlyFee === 0) never need a plan.
 *
 * Does not persist — caller decides whether/how to save the result.
 */
export async function syncBillingPlanItem(
  item: BillingPlanConfigItem
): Promise<BillingPlanConfigItem> {
  if (item.monthlyFee === 0) {
    return item;
  }

  if (item.paystackPlanCode && item.paystackPlanAmount === item.monthlyFee) {
    return item; // already in sync
  }

  if (item.paystackPlanCode) {
    // Amount drifted since the plan was created — update it in place.
    const updated = await updatePaystackPlan(item.paystackPlanCode, {
      amount: item.monthlyFee,
    });
    if (updated.success) {
      return { ...item, paystackPlanAmount: item.monthlyFee };
    }
    console.error(
      `Failed to update Paystack plan ${item.paystackPlanCode}:`,
      updated.error
    );
    // Fall through and try creating a fresh plan instead.
  }

  const created = await createPaystackPlan({
    name: `${item.label} - Monthly`,
    amount: item.monthlyFee,
    interval: "monthly",
  });

  if (!created.success || !created.data) {
    console.error("Failed to create Paystack plan:", created.error);
    return item; // leave unsynced; caller/next attempt can retry
  }

  return {
    ...item,
    paystackPlanCode: created.data.planCode,
    paystackPlanAmount: item.monthlyFee,
  };
}

/**
 * Ensure a Paystack Plan code exists for the given billing tier, creating one
 * on demand if needed, and persisting it back to platform config. Returns
 * null for free tiers (no plan/subscription needed).
 */
export async function ensurePlanCodeForBillingPlan(
  billingPlan: TenantBillingPlan
): Promise<string | null> {
  const config = await getPlatformConfig();
  const item = config.billingPlans[billingPlan];

  if (item.monthlyFee === 0) {
    return null;
  }

  const synced = await syncBillingPlanItem(item);

  if (
    synced.paystackPlanCode !== item.paystackPlanCode ||
    synced.paystackPlanAmount !== item.paystackPlanAmount
  ) {
    await setPlatformConfig({
      ...config,
      billingPlans: { ...config.billingPlans, [billingPlan]: synced },
    });
  }

  if (!synced.paystackPlanCode) {
    throw new Error(
      "Failed to prepare this billing plan for payment. Please try again."
    );
  }

  return synced.paystackPlanCode;
}
