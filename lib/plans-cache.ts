import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlans } from "@/lib/firestore-helpers";
import { createDocCache } from "@/lib/doc-cache";
import { Plan } from "@/types/schemas";

/**
 * A tenant's sellable plans, which is the one query every public page runs.
 *
 * The storefront (`/{slug}`) and the captive portal (`/{slug}/portal`) both
 * fetch it on every render, and it bills **one read per plan document, per
 * visitor, per page view** - on the two pages whose traffic scales with a
 * venue's customers rather than with the owner's clicking. A location with
 * six plans and a busy evening is where the read quota actually goes now
 * that the per-request lookups are cached.
 *
 * The data behind it changes when an owner edits a plan: a handful of times
 * ever, from a page in this same process. So it is cached in memory with a
 * short TTL and invalidated explicitly on every write, exactly like
 * `lib/tenant-cache.ts` - and for the same reason that cache exists.
 *
 * In-process rather than `unstable_cache` because `Plan` carries real
 * `Date`s and Next's data cache round-trips through JSON, which is the trap
 * `lib/tenant-cache.ts` has to serialize around. Nothing to convert here.
 *
 * Deliberately only the **active** plans, which is all either public page
 * shows. The admin plans table wants the inactive ones too and is one
 * owner looking at their own data, so it keeps reading straight through.
 */
const PLANS_CACHE_MS = 60 * 1000;
const plansCache = createDocCache<Plan[]>(PLANS_CACHE_MS);

export async function getCachedActivePlans(tenantId: string): Promise<Plan[]> {
  return plansCache.get(tenantId, async () => {
    const snapshot = await adminDb
      .collection(TENANT_COLLECTIONS.plans(tenantId))
      .where("active", "==", true)
      .get();
    return parsePlans(snapshot.docs);
  });
}

/**
 * Call after creating, editing or deleting any plan. Takes the tenant, not
 * the plan: the cached value is the whole list, so any change to any plan
 * replaces all of it.
 */
export function invalidateTenantPlans(tenantId: string): void {
  plansCache.invalidate(tenantId);
}
