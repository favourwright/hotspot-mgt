/**
 * Whether a buyer may start paying for a plan right now. One function, so
 * the dialog's preview (`can-purchase`) and the route that actually starts
 * the charge (`/api/purchase/initiate`) cannot disagree.
 *
 * Every refusal here happens **before** Paystack opens, which is the only
 * time refusing is free. Once money has moved, fulfilment does not refuse
 * over these things; it records a payment review instead. So checking
 * plan, location and router here is what keeps those reviews rare: they
 * used to be checked only after the charge.
 */

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  getTenantCustomer,
  getTenantCustomerCount,
  parseLocation,
  parsePlan,
} from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import {
  BILLING_LOCK_PORTAL_MESSAGE,
  isTenantBillingLocked,
} from "@/lib/billing-lock";
import type { Location, Plan, Tenant } from "@/types/schemas";

const UNAVAILABLE = "This plan isn't available right now. Please try another, or check back later.";
const FULL =
  "This business isn't accepting new customers right now. Please check back later.";

export type Eligibility =
  | { ok: true; plan: Plan | null; location: Location | null }
  | { ok: false; status: number; reason: string };

/**
 * `planId` and `locationId` are optional because `can-purchase` has
 * callers that ask only "is this network full for me", exactly as before.
 * The initiate route always passes both.
 */
export async function checkPurchaseEligibility(args: {
  tenant: Pick<Tenant, "id" | "planId">;
  uid: string;
  planId?: string | null;
  locationId?: string | null;
}): Promise<Eligibility> {
  const { tenant, uid } = args;

  // Before any limit check, because this is not about this buyer at all:
  // the tenant owes their plan fee and has run out of grace. Existing
  // customers are refused too. Vouchers already sold keep working; only
  // the next sale stops. See lib/billing-lock.ts.
  if (await isTenantBillingLocked(tenant.id)) {
    return { ok: false, status: 402, reason: BILLING_LOCK_PORTAL_MESSAGE };
  }

  let plan: Plan | null = null;
  let location: Location | null = null;

  if (args.planId && args.locationId) {
    const [planDoc, locationDoc] = await Promise.all([
      adminDb.collection(TENANT_COLLECTIONS.plans(tenant.id)).doc(args.planId).get(),
      adminDb
        .collection(TENANT_COLLECTIONS.locations(tenant.id))
        .doc(args.locationId)
        .get(),
    ]);
    plan = parsePlan(planDoc);
    location = parseLocation(locationDoc);

    // A plan belongs to exactly one location; buying it "at" another one
    // would provision it on a router it was never configured for.
    if (!plan || !plan.active || plan.locationId !== args.locationId) {
      return { ok: false, status: 404, reason: UNAVAILABLE };
    }
    if (!location || !location.active) {
      return { ok: false, status: 404, reason: UNAVAILABLE };
    }

    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenant.id))
      .doc(location.routerId)
      .get();
    if (!routerDoc.exists || !routerDoc.data()?.active) {
      return { ok: false, status: 503, reason: UNAVAILABLE };
    }
  }

  // The actual enforcement point for a plan's maxCustomers limit. Existing
  // customers of a tenant always pass; only a brand-new customer can be
  // blocked, and only before they have paid.
  const existingCustomer = await getTenantCustomer(tenant.id, uid);
  if (!existingCustomer) {
    const billingPlan = await getBillingPlanById(tenant.planId);
    const maxCustomers = billingPlan?.limits.maxCustomers ?? null;
    if (maxCustomers !== null) {
      const currentCount = await getTenantCustomerCount(tenant.id);
      if (currentCount >= maxCustomers) {
        return { ok: false, status: 403, reason: FULL };
      }
    }
  }

  return { ok: true, plan, location };
}
