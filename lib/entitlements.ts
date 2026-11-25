/**
 * Whether a tenant may use an addon.
 *
 * One resolver, one gate, so there is a single place to audit when asking
 * "can this be bypassed". Three rules, in order:
 *
 *  1. A `free` addon is on for everybody. No entitlement document exists,
 *     which is what makes "turn this on for everyone" a one-field change
 *     rather than a backfill across every tenant.
 *  2. The tenant's billing plan may grant it (`BillingPlan.includedAddons`).
 *     This is never written to the entitlement collection, so changing a
 *     plan's bundle takes effect immediately and withdrawing a key from a
 *     bundle cannot delete an addon the tenant separately paid for.
 *  3. Otherwise there must be an entitlement document, written by the server
 *     from payment facts, whose status still allows access.
 *
 * Deliberately NOT a boolean on the tenant document. That document was
 * owner-writable from the browser (see firestore.rules), and an entitlement
 * a tenant can set themselves is not an entitlement. The entitlements
 * subcollection is closed to the client in both directions.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { getBillingPlanById } from "@/lib/billing-plans";
import { AddonKey } from "@/lib/addon-catalog";
import { Addon, AddonEntitlement, EntitlementStatus } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";
import { cache } from "react";
import { createDocCache } from "@/lib/doc-cache";
import { getTenantDocById } from "@/lib/tenant-cache";

/**
 * The addon catalog is a price list written only by the superadmin addons
 * page, and read by every gate - including the captive portal's, on every
 * single page view. Cached across requests for the same reason billing
 * plans are; lib/addons.ts invalidates on every write.
 */
const ADDON_CACHE_MS = 5 * 60 * 1000;
const addonCache = createDocCache<Addon | null>(ADDON_CACHE_MS);

export function invalidateAddon(key: string): void {
  addonCache.invalidate(key);
}

/**
 * How long a failed subscription payment keeps working.
 *
 * Paystack retries a failed invoice over several days and fires
 * `invoice.payment_failed` on the **first** attempt, not the last. Cutting
 * access off on that first signal would black out a venue's wifi over a card
 * that was going to clear on retry, and the tenant would have no idea why.
 * Access ends when the grace window closes or Paystack tells us the
 * subscription is actually over, whichever comes first.
 */
export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

export interface EntitlementState {
  addonKey: string;
  entitled: boolean;
  /** Why, so the UI and the logs can say something specific. */
  reason:
    | "free"
    | "included-in-plan"
    | "purchased"
    | "in-grace"
    | "not-purchased"
    | "lapsed"
    | "cancelled"
    | "unknown-addon";
  status: EntitlementStatus | null;
  /** When access ends if nothing changes. Null means it does not. */
  endsAt: Date | null;
}

/**
 * Read one addon's catalog document.
 *
 * React-cached, so a page that checks the same addon from a layout, a server
 * component and an API helper in one request pays for a single read.
 */
export const getAddon = cache(async function getAddon(
  key: string
): Promise<Addon | null> {
  return addonCache.get(key, async () => {
    const doc = await adminDb.collection(COLLECTIONS.ADDONS).doc(key).get();
    const data = doc.data();
    if (!doc.exists || !data) return null;

    return {
      key: doc.id,
      name: data.name ?? key,
      description: data.description ?? "",
      pricingModel: data.pricingModel ?? "subscription",
      amount: data.amount ?? 0,
      billingInterval: data.billingInterval ?? "monthly",
      paystackPlanCode: data.paystackPlanCode ?? null,
      paystackPlanAmount: data.paystackPlanAmount ?? null,
      active: data.active ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdAt: toDate(data.createdAt) ?? new Date(),
      updatedAt: toDate(data.updatedAt) ?? new Date(),
    };
  });
});

/**
 * React-cached, not TTL-cached: this is the paywall's own record and it is
 * written by the webhook, which may well be another process. A stale "still
 * entitled" is free access that nothing in here can clear, so the only
 * saving taken is the one that is always safe - the repeats inside a single
 * request. /admin/addons checks every key in the catalog at once, and each
 * check used to re-read.
 */
export const getEntitlement = cache(async function getEntitlement(
  tenantId: string,
  addonKey: string
): Promise<AddonEntitlement | null> {
  const doc = await adminDb
    .collection(TENANT_COLLECTIONS.entitlements(tenantId))
    .doc(addonKey)
    .get();
  const data = doc.data();
  if (!doc.exists || !data) return null;

  return {
    addonKey: doc.id,
    source: data.source === "grant" ? "grant" : "purchase",
    status: data.status ?? "expired",
    pricingModel: data.pricingModel ?? "subscription",
    lastPaymentRef: data.lastPaymentRef ?? null,
    amountPaid: data.amountPaid ?? 0,
    grantedAt: toDate(data.grantedAt) ?? new Date(0),
    currentPeriodEnd: toDate(data.currentPeriodEnd),
    pastDueSince: toDate(data.pastDueSince),
    cancelledAt: toDate(data.cancelledAt),
    updatedAt: toDate(data.updatedAt) ?? new Date(0),
  };
});

/**
 * The full picture for one addon, including why.
 *
 * Fails **closed** on anything unexpected. An addon key with no catalog
 * document resolves to not-entitled rather than entitled, because the two
 * ways this can be wrong are not symmetrical: wrongly denying a paying
 * tenant is a support ticket, wrongly granting is the paywall not existing.
 */
export async function getEntitlementState(
  tenantId: string,
  addonKey: string,
  now: Date = new Date()
): Promise<EntitlementState> {
  const addon = await getAddon(addonKey);

  if (!addon) {
    return {
      addonKey,
      entitled: false,
      reason: "unknown-addon",
      status: null,
      endsAt: null,
    };
  }

  if (addon.pricingModel === "free") {
    return {
      addonKey,
      entitled: true,
      reason: "free",
      status: null,
      endsAt: null,
    };
  }

  // A plan grant outranks a purchase: it costs the tenant nothing and
  // cannot lapse, so there is no point checking payment state behind it.
  if (await planGrants(tenantId, addonKey)) {
    return {
      addonKey,
      entitled: true,
      reason: "included-in-plan",
      status: null,
      endsAt: null,
    };
  }

  const entitlement = await getEntitlement(tenantId, addonKey);
  if (!entitlement) {
    return {
      addonKey,
      entitled: false,
      reason: "not-purchased",
      status: null,
      endsAt: null,
    };
  }

  return evaluateEntitlement(addonKey, entitlement, now);
}

/**
 * Status plus clock. Separated and exported so the grace-window arithmetic
 * is testable without Firestore, and so `now` is injected rather than read
 * twice during one evaluation.
 */
export function evaluateEntitlement(
  addonKey: string,
  entitlement: AddonEntitlement,
  now: Date
): EntitlementState {
  const { status } = entitlement;

  if (status === "cancelled") {
    // Paystack's `subscription.not_renew` means "will not renew", not
    // "stopped now", so a cancelled subscription keeps working to the end of
    // the period the tenant already paid for.
    const endsAt = entitlement.currentPeriodEnd;
    const stillPaidFor = endsAt !== null && endsAt.getTime() > now.getTime();
    return {
      addonKey,
      entitled: stillPaidFor,
      reason: stillPaidFor ? "purchased" : "cancelled",
      status,
      endsAt,
    };
  }

  if (status === "expired") {
    return { addonKey, entitled: false, reason: "lapsed", status, endsAt: null };
  }

  if (status === "past_due") {
    const since = entitlement.pastDueSince;
    // No timestamp means we cannot prove the grace window has closed, and
    // denying on an unprovable claim would cut off a tenant over our own
    // missing data. Treat it as the window having just opened.
    const graceEnds = new Date(
      (since?.getTime() ?? now.getTime()) + PAST_DUE_GRACE_MS
    );
    const inGrace = graceEnds.getTime() > now.getTime();
    return {
      addonKey,
      entitled: inGrace,
      reason: inGrace ? "in-grace" : "lapsed",
      status,
      endsAt: graceEnds,
    };
  }

  // Active. A one-time purchase has no period end and never expires.
  if (entitlement.pricingModel === "one_time") {
    return {
      addonKey,
      entitled: true,
      reason: "purchased",
      status,
      endsAt: null,
    };
  }

  // An active subscription whose period has quietly run out without any
  // webhook arriving. Rather than trust the status alone, the clock decides:
  // a missed `invoice.payment_failed` must not become permanent free access.
  const endsAt = entitlement.currentPeriodEnd;
  if (endsAt !== null && endsAt.getTime() <= now.getTime()) {
    const graceEnds = new Date(endsAt.getTime() + PAST_DUE_GRACE_MS);
    const inGrace = graceEnds.getTime() > now.getTime();
    return {
      addonKey,
      entitled: inGrace,
      reason: inGrace ? "in-grace" : "lapsed",
      status,
      endsAt: graceEnds,
    };
  }

  return { addonKey, entitled: true, reason: "purchased", status, endsAt };
}

/**
 * The tenant's plan id. Split out and React-cached so that checking several
 * addons in one request - which /admin/addons and /api/admin/addons both do,
 * once per key in the catalog - costs one read of the tenant document rather
 * than one per key. The plan itself is cached in lib/billing-plans.ts.
 */
async function tenantPlanId(tenantId: string): Promise<string | null> {
  const planId = (await getTenantDocById(tenantId))?.planId;
  return typeof planId === "string" && planId ? planId : null;
}

/** Whether the tenant's billing plan bundles this addon. */
async function planGrants(
  tenantId: string,
  addonKey: string
): Promise<boolean> {
  const planId = await tenantPlanId(tenantId);
  if (!planId) return false;

  const plan = await getBillingPlanById(planId);
  return plan?.includedAddons?.includes(addonKey) ?? false;
}

/** The short answer, for call sites that only need yes or no. */
export async function hasAddon(
  tenantId: string,
  addonKey: string
): Promise<boolean> {
  return (await getEntitlementState(tenantId, addonKey)).entitled;
}

export class AddonRequiredError extends Error {
  constructor(
    readonly addonKey: string,
    readonly state: EntitlementState
  ) {
    super(`Addon "${addonKey}" is required.`);
    this.name = "AddonRequiredError";
  }
}

/**
 * The gate. Throws `AddonRequiredError` when the tenant may not proceed.
 *
 * Call this at the top of a route handler, after authentication and before
 * any side effect. Hiding a button is presentation; this is the boundary.
 *
 * Takes `AddonKey`, not `string`, even though everything below it accepts any
 * key. A gate names a key that has to exist in lib/addon-catalog.ts, so a
 * typo here is a compile error rather than a gate that silently never matches
 * an addon and therefore blocks every tenant forever.
 */
export async function requireAddon(
  tenantId: string,
  addonKey: AddonKey
): Promise<EntitlementState> {
  const state = await getEntitlementState(tenantId, addonKey);
  if (!state.entitled) throw new AddonRequiredError(addonKey, state);
  return state;
}
