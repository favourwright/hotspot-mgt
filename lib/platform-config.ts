import { cache } from "react";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import {
  PlatformConfig,
  PlatformConfigSchema,
  DEFAULT_BILLING_PLAN_CONFIG,
} from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

const PLATFORM_CONFIG_DOC = "config";

/**
 * Default platform config used when Firestore
 * document does not exist yet.
 */
const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  billingPlans: DEFAULT_BILLING_PLAN_CONFIG,
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
