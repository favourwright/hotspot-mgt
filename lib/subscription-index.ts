/**
 * Which thing a Paystack subscription pays for.
 *
 * A tenant has exactly one Paystack customer code. Their platform
 * subscription and every addon subscription they buy all carry it, differing
 * only by `subscription_code` and `plan_code`. The webhook originally
 * resolved every subscription event by customer code alone, which meant the
 * first addon subscription a tenant bought would:
 *
 *  - overwrite `tenant.paystackSubscriptionCode` on `subscription.create`,
 *    silently severing platform billing from its real subscription;
 *  - mark the whole tenant `past_due` when the addon's invoice failed;
 *  - email "your subscription renewed" for an addon renewal.
 *
 * This index makes the target explicit. Keyed by subscription code so a
 * lookup is one get-by-id: no composite index to build, no query that can
 * return two rows, and nothing to go stale between a write and a read.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import type { AddonKey } from "@/lib/addon-catalog";

export type SubscriptionTarget =
  | { kind: "platform"; tenantId: string }
  | { kind: "addon"; tenantId: string; addonKey: AddonKey };

function ref(subscriptionCode: string) {
  return adminDb
    .collection(COLLECTIONS.SUBSCRIPTION_INDEX)
    .doc(subscriptionCode);
}

/**
 * Record what a subscription code pays for.
 *
 * Idempotent: Paystack re-delivers webhooks, and a repeated
 * `subscription.create` must not produce a second, conflicting row. The
 * document id *is* the subscription code, so a repeat is an overwrite of
 * identical data.
 */
export async function linkSubscription(
  subscriptionCode: string,
  target: SubscriptionTarget
): Promise<void> {
  await ref(subscriptionCode).set(
    {
      subscriptionCode,
      kind: target.kind,
      tenantId: target.tenantId,
      addonKey: target.kind === "addon" ? target.addonKey : null,
      createdAt: new Date(),
    },
    { merge: true }
  );
}

/**
 * Resolve a subscription code, or null when we have never seen it.
 *
 * Null is a real answer and callers must handle it rather than guessing:
 * subscriptions created before this index existed have no row, and so does
 * anything belonging to a different integration sharing the same Paystack
 * account. Guessing "it must be the platform subscription" is exactly the
 * bug this file exists to prevent.
 */
export async function resolveSubscription(
  subscriptionCode: string
): Promise<SubscriptionTarget | null> {
  const doc = await ref(subscriptionCode).get();
  const data = doc.data();
  if (!doc.exists || !data) return null;

  if (data.kind === "addon") {
    if (typeof data.addonKey !== "string" || !data.addonKey) return null;
    return {
      kind: "addon",
      tenantId: data.tenantId,
      addonKey: data.addonKey as AddonKey,
    };
  }

  if (data.kind === "platform") {
    return { kind: "platform", tenantId: data.tenantId };
  }

  return null;
}

/**
 * Backfill for a tenant whose platform subscription predates this index.
 *
 * Called from the webhook's fallback path: once we have had to resolve a
 * subscription the slow way, record it so the next event for the same code
 * takes the fast, unambiguous path.
 */
export async function linkPlatformSubscriptionIfMissing(
  subscriptionCode: string,
  tenantId: string
): Promise<void> {
  const existing = await ref(subscriptionCode).get();
  if (existing.exists) return;
  await linkSubscription(subscriptionCode, { kind: "platform", tenantId });
}

/**
 * The subscription code already recorded for one tenant's addon, if any.
 *
 * Covers the ordering race between paying and activating: Paystack may
 * deliver `subscription.create` before the browser gets back to us with the
 * reference, in which case the index row exists before the entitlement does.
 * Activation reads it here rather than assuming the webhook will arrive
 * second.
 *
 * Two equality filters need no composite index in Firestore, so this adds
 * nothing to firestore.indexes.json.
 */
export async function findSubscriptionForAddon(
  tenantId: string,
  addonKey: AddonKey
): Promise<string | null> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.SUBSCRIPTION_INDEX)
    .where("tenantId", "==", tenantId)
    .where("addonKey", "==", addonKey)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return snapshot.docs[0].id;
}
