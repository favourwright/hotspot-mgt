import { unstable_cache, revalidateTag } from "next/cache";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";

/**
 * What the admin chrome needs to know about a tenant's routers and
 * locations, on every admin page: whether setup is finished, and whether
 * any router is down.
 *
 * ## Why it is its own read
 *
 * The nav changes shape once setup is done (`components/tenant/admin-nav.tsx`)
 * and the notice region names an offline router, and both are rendered by
 * the admin layout, so this runs for every admin route. The dashboard's
 * stats already count routers and locations, but they are cached on a tag
 * that sales clear and router edits do not, so a tenant who had just added
 * their first location would keep the setup nav for up to five minutes.
 * This has its own tag, cleared by exactly the writers that change it.
 *
 * ## "Set up" is one question
 *
 * A location cannot be created without a router (`/api/admin/locations`
 * refuses), so "has a location" answers "has a router and a location".
 *
 * ## Cost
 *
 * One read per router (a tenant has a handful at most, capped by plan) plus
 * one for the location probe, and only on a cache miss. The 15-minute
 * backstop matches `router-health`, which clears the tag itself on every
 * online/offline transition, so the TTL only matters for a write nothing
 * invalidated.
 */
export interface TenantFleet {
  setupComplete: boolean;
  offlineRouters: Array<{ id: string; name: string }>;
}

const FLEET_SECONDS = 15 * 60;

export function tenantFleetTag(tenantId: string): string {
  return `tenant-fleet:${tenantId}`;
}

async function loadTenantFleet(tenantId: string): Promise<TenantFleet> {
  const [routers, locations] = await Promise.all([
    // Unfiltered and projected: no index to maintain, and the router
    // documents carry credentials that have no business in a cache entry.
    adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .select("name", "status", "active")
      .get(),
    adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).limit(1).select().get(),
  ]);

  return {
    setupComplete: !locations.empty,
    // Inactive routers are not health-checked, so their status is whatever
    // it was when they were switched off and says nothing about today.
    // "pending" is a router mid-registration, which the owner is already
    // looking at.
    offlineRouters: routers.docs
      .filter((d) => d.get("active") !== false && d.get("status") === "offline")
      .map((d) => ({ id: d.id, name: (d.get("name") as string) || "Unnamed router" })),
  };
}

// Bump the version with any change to TenantFleet's shape, as in
// lib/stats-cache.ts: a previous deploy's entry is otherwise served to the
// new code until it expires.
export async function getTenantFleet(tenantId: string): Promise<TenantFleet> {
  return unstable_cache(() => loadTenantFleet(tenantId), ["tenant-fleet-v1", tenantId], {
    tags: [tenantFleetTag(tenantId)],
    revalidate: FLEET_SECONDS,
  })();
}

/**
 * Call after any write to a tenant's routers or locations: created,
 * deleted, switched on or off, or a status change.
 *
 * Never throws, for the same reason as `invalidateTenantStats`: it runs at
 * the end of writes that have already committed, and from the cron runner,
 * where a cache that could not be cleared must not fail the pass.
 */
export function invalidateTenantFleet(tenantId: string): void {
  try {
    revalidateTag(tenantFleetTag(tenantId), { expire: 0 });
  } catch (error) {
    console.warn(`[tenant-fleet] could not invalidate tenant ${tenantId}:`, error);
  }
}
