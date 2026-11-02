import { AuthError } from "@/lib/auth-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  isAtPlanLimit,
  planLimitMessage,
  type PlanResourceLimit,
} from "@/lib/plan-resource-limits";

const COUNTED_COLLECTION: Record<
  PlanResourceLimit,
  (tenantId: string) => string
> = {
  maxRouters: TENANT_COLLECTIONS.routers,
  maxLocations: TENANT_COLLECTIONS.locations,
};

/**
 * Throws a 403 when the tenant has no room for another router or location.
 *
 * Call it before any side effect: the WireGuard peer in
 * `/api/admin/routers/provision`, or the router connection test on a create.
 *
 * The count is live rather than `getCachedTenantStats`, because an owner who
 * has just deleted a router must be able to register its replacement straight
 * away. A missing plan does not block anything, the same as `maxCustomers`.
 * Two simultaneous requests can both pass, which costs one extra router and
 * is not worth a transaction.
 *
 * Only creation is limited. A tenant who downgrades keeps everything they
 * already run: see `lib/plan-change.ts`.
 */
export async function assertWithinPlanLimit(
  tenantId: string,
  limit: PlanResourceLimit
): Promise<void> {
  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  const planId = tenantDoc.data()?.planId;
  if (!planId) return;

  const plan = await getBillingPlanById(planId);
  const allowed = plan?.limits[limit] ?? null;
  if (allowed === null) return;

  const snapshot = await adminDb
    .collection(COUNTED_COLLECTION[limit](tenantId))
    .count()
    .get();

  if (isAtPlanLimit(snapshot.data().count, allowed)) {
    throw new AuthError(planLimitMessage(limit, allowed, plan?.name), 403);
  }
}
