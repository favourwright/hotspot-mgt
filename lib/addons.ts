/**
 * The addon catalog, and turning a purchase into an entitlement.
 *
 * Catalog management mirrors lib/billing-plans.ts deliberately, including the
 * Paystack Plan drift-detection: if the cached plan amount no longer matches
 * the addon's price, the Plan is updated on Paystack before anyone is charged
 * against it. Two systems that do the same thing differently is how one of
 * them ends up wrong.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { createPaystackPlan, updatePaystackPlan } from "@/lib/paystack";
import { ADDON_CATALOG, ADDON_KEYS, AddonKey } from "@/lib/addon-catalog";
import { Addon } from "@/types/schemas";
import { getAddon } from "@/lib/entitlements";
import { Timestamp } from "firebase-admin/firestore";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Every addon the code knows about, merged with whatever the database says.
 *
 * Driven from ADDON_KEYS rather than from the collection, so an addon that
 * has never been configured still appears (as an unsellable draft) instead of
 * vanishing from the superadmin page with no hint that a gate exists for it.
 */
export async function getAllAddons(): Promise<Addon[]> {
  const snapshot = await adminDb.collection(COLLECTIONS.ADDONS).get();
  const stored = new Map(snapshot.docs.map((d) => [d.id, d.data()]));

  return ADDON_KEYS.map((key) => {
    const data = stored.get(key);
    const entry = ADDON_CATALOG[key];

    return {
      key,
      name: data?.name ?? entry.name,
      description: data?.description ?? entry.description,
      // An unconfigured addon defaults to a subscription nobody can buy
      // (active: false), never to free. Defaulting to free would hand out
      // every unconfigured gate for nothing.
      pricingModel: data?.pricingModel ?? "subscription",
      amount: data?.amount ?? 0,
      billingInterval: data?.billingInterval ?? "monthly",
      paystackPlanCode: data?.paystackPlanCode ?? null,
      paystackPlanAmount: data?.paystackPlanAmount ?? null,
      active: data?.active ?? false,
      sortOrder: data?.sortOrder ?? 0,
      createdAt: toDate(data?.createdAt) ?? new Date(),
      updatedAt: toDate(data?.updatedAt) ?? new Date(),
    } satisfies Addon;
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export interface UpsertAddonInput {
  name: string;
  description: string;
  pricingModel: Addon["pricingModel"];
  amount: number;
  billingInterval: Addon["billingInterval"];
  active: boolean;
  sortOrder: number;
}

export async function upsertAddon(
  key: AddonKey,
  input: UpsertAddonInput
): Promise<void> {
  const ref = adminDb.collection(COLLECTIONS.ADDONS).doc(key);
  const existing = await ref.get();

  await ref.set(
    {
      ...input,
      // A free addon has no price and no Paystack Plan. Clearing these on
      // the way in stops a stale plan code being used later if the addon is
      // switched back to paid at a different price.
      amount: input.pricingModel === "free" ? 0 : input.amount,
      ...(input.pricingModel === "subscription"
        ? {}
        : { paystackPlanCode: null, paystackPlanAmount: null }),
      createdAt: existing.exists ? existing.data()?.createdAt : new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

/**
 * Ensure a subscription addon has a Paystack Plan matching its current price,
 * and return the code to charge against.
 *
 * Same contract as ensurePlanCodeForBillingPlan: creates on demand, updates
 * in place on price drift, persists the cache, throws rather than returning a
 * code that would charge the wrong amount.
 */
export async function ensureAddonPlanCode(key: AddonKey): Promise<string> {
  const addon = await getAddon(key);
  if (!addon) throw new Error("Addon is not configured.");
  if (addon.pricingModel !== "subscription") {
    throw new Error("This addon is not a subscription.");
  }
  if (addon.amount <= 0) {
    throw new Error("This addon has no price set.");
  }

  if (addon.paystackPlanCode && addon.paystackPlanAmount === addon.amount) {
    return addon.paystackPlanCode;
  }

  let planCode = addon.paystackPlanCode;

  if (planCode) {
    const updated = await updatePaystackPlan(planCode, {
      amount: addon.amount,
    });
    if (!updated.success) {
      console.error(
        `Failed to update Paystack plan ${planCode} for addon ${key}:`,
        updated.error
      );
      planCode = null;
    }
  }

  if (!planCode) {
    const created = await createPaystackPlan({
      name: `Addon: ${addon.name}`,
      amount: addon.amount,
      // Paystack calls it "annually"; the schema uses "yearly" to match
      // BillingPlan.billingInterval, so the two vocabularies meet here.
      interval: addon.billingInterval === "yearly" ? "annually" : "monthly",
    });
    if (!created.success || !created.data) {
      throw new Error("Could not prepare this addon for payment.");
    }
    planCode = created.data.planCode;
  }

  await adminDb.collection(COLLECTIONS.ADDONS).doc(key).update({
    paystackPlanCode: planCode,
    paystackPlanAmount: addon.amount,
    updatedAt: new Date(),
  });

  return planCode;
}

/**
 * Write the entitlement a verified payment earns.
 *
 * Called only from the activate route, after the transaction has been
 * verified against Paystack and the reference claimed. Nothing else in the
 * codebase writes to this collection except the webhook, which only ever
 * updates an entitlement that already exists.
 */
export async function grantEntitlement(params: {
  tenantId: string;
  addonKey: AddonKey;
  pricingModel: Addon["pricingModel"];
  amountPaid: number;
  reference: string;
  paystackCustomerCode: string | null;
  /** Subscriptions only; null for a one-time purchase. */
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const now = new Date();

  await adminDb
    .collection(TENANT_COLLECTIONS.entitlements(params.tenantId))
    .doc(params.addonKey)
    .set(
      {
        addonKey: params.addonKey,
        source: "purchase",
        status: "active",
        pricingModel: params.pricingModel,
        paystackCustomerCode: params.paystackCustomerCode,
        lastPaymentRef: params.reference,
        amountPaid: params.amountPaid,
        currentPeriodEnd: params.currentPeriodEnd,
        // A repurchase after a lapse must clear the old lapse markers, or
        // the grace-window arithmetic would still be reading them.
        pastDueSince: null,
        cancelledAt: null,
        grantedAt: now,
        updatedAt: now,
      },
      { merge: true }
    );
}

/**
 * Which addon a Paystack Plan code belongs to.
 *
 * This is how `subscription.create` is attributed. That event arrives
 * asynchronously after the customer pays, carries the same customer code as
 * the tenant's platform subscription, and is not covered by the subscription
 * index yet precisely because the index is what it is about to populate. Its
 * `plan.plan_code` is the one field that distinguishes it, and every addon
 * owns its Plan object exclusively.
 *
 * Returns null rather than guessing, which leaves the webhook to fall back to
 * its "already has a platform subscription, so ignore" safety net.
 */
export async function findAddonByPlanCode(
  planCode: string
): Promise<AddonKey | null> {
  const snapshot = await adminDb
    .collection(COLLECTIONS.ADDONS)
    .where("paystackPlanCode", "==", planCode)
    .limit(1)
    .get();

  if (snapshot.empty) return null;

  const key = snapshot.docs[0].id;
  return (ADDON_KEYS as readonly string[]).includes(key)
    ? (key as AddonKey)
    : null;
}
