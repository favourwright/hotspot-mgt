import { cache } from "react";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { PlatformConfig, PlatformConfigSchema } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";
import { createDocCache } from "@/lib/doc-cache";

const PLATFORM_CONFIG_DOC = "config";

/**
 * One document, read on every checkout, every fee estimate, every router or
 * location provision - and written only by the superadmin config page.
 *
 * React's cache() below already collapses the repeats inside a single
 * render; this is what stops the *next* visitor paying for the same read.
 * setPlatformConfig invalidates, so a superadmin saving the page sees their
 * own change immediately rather than in five minutes.
 */
const CONFIG_CACHE_MS = 5 * 60 * 1000;
const CONFIG_CACHE_KEY = "platform-config";
const configCache = createDocCache<PlatformConfig>(CONFIG_CACHE_MS);

/**
 * Default platform config used when Firestore document does not exist yet.
 * Billing plans used to live here too - they're now their own collection
 * (see lib/billing-plans.ts); this doc is just WireGuard server config and
 * the Paystack fee-bearer setting now.
 */
const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  paystackBearer: "account",
  wireguard: {
    serverPublicKey: "",
    serverEndpoint: "",
    tunnelSubnet: "10.10.0.0/16",
  },
  paystackFeePassthrough: {
    enabled: false,
    percent: 1.5,
    flatFeeKobo: 10000,
    capKobo: 200000,
    waiveFlatFeeBelowKobo: 250000,
  },
  planFeeGraceDays: 3,
};

/**
 * Fetch platform config from Firestore.
 * Falls back to DEFAULT_PLATFORM_CONFIG if the
 * document does not exist yet.
 *
 * Two layers: React cache() deduplicates within one render, configCache
 * reuses the read across requests until a superadmin saves the page.
 */
export const getPlatformConfig = cache(
  async (): Promise<PlatformConfig> => {
    try {
      return await configCache.get(CONFIG_CACHE_KEY, loadPlatformConfig);
    } catch (error) {
      // Falling back to defaults is the right answer for one request and the
      // wrong thing to remember: a transient Firestore error would otherwise
      // pin `paystackBearer` to its default for the whole TTL, which moves
      // real money for every sale in that window. The catch therefore sits
      // outside the cache - a rejected load is never stored, so the next
      // reader tries again.
      console.error("Failed to fetch platform config, using defaults:", error);
      return DEFAULT_PLATFORM_CONFIG;
    }
  }
);

async function loadPlatformConfig(): Promise<PlatformConfig> {
  const doc = await adminDb
    .collection(COLLECTIONS.PLATFORM)
    .doc(PLATFORM_CONFIG_DOC)
    .get();

  if (!doc.exists) {
    // Document doesn't exist yet - use defaults
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
}

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

  // The next reader must see what was just saved, not the copy from before.
  configCache.invalidate(CONFIG_CACHE_KEY);
}
