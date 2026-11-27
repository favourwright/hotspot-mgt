import { AuthError } from "@/lib/auth-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { adminDb } from "@/lib/firebase-admin";
import type { CapacityCheck } from "@/lib/tenant-capacity";
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

/** What one plan limit allows this tenant, and the query it is counted with. */
export async function planLimitCheck(
  tenantId: string,
  limit: PlanResourceLimit
): Promise<CapacityCheck> {
  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  const planId = tenantDoc.data()?.planId;
  // A missing plan does not block anything, the same as `maxCustomers`.
  const plan = planId ? await getBillingPlanById(planId) : null;
  const allowed = plan?.limits[limit] ?? null;

  return {
    counted: adminDb.collection(COUNTED_COLLECTION[limit](tenantId)),
    allowed,
    fullMessage: allowed === null ? "" : planLimitMessage(limit, allowed, plan?.name),
    fullStatus: 403,
  };
}

/**
 * Throws a 403 when the tenant has no room for another router or location.
 *
 * An early answer, not the guarantee. Call it before any side effect (the
 * WireGuard peer in `/api/admin/routers/provision`, the router connection
 * test on a create) so a tenant at their limit is told before anything is
 * spent. The create itself re-checks inside its write with
 * `createWithinCapacity` (lib/tenant-capacity.ts), which is what stops two
 * simultaneous requests both taking the last seat.
 *
 * The count is live rather than `getCachedTenantStats`, because an owner who
 * has just deleted a router must be able to register its replacement straight
 * away.
 *
 * Only creation is limited. A tenant who downgrades keeps everything they
 * already run: see `lib/plan-change.ts`.
 */
export async function assertWithinPlanLimit(
  tenantId: string,
  limit: PlanResourceLimit
): Promise<void> {
  const check = await planLimitCheck(tenantId, limit);
  if (check.allowed === null) return;

  const snapshot = await check.counted.count().get();
  if (isAtPlanLimit(snapshot.data().count, check.allowed)) {
    throw new AuthError(check.fullMessage, 403);
  }
}
