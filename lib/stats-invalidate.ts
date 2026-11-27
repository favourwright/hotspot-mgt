import { revalidateTag } from "next/cache";

/**
 * The tenant dashboard's cache tag, and clearing it.
 *
 * Its own module so that the sale path, which calls this, does not import
 * the dashboard's queries (lib/stats-cache.ts reads the tag from here).
 */
export function tenantStatsTag(tenantId: string): string {
  return `tenant-stats:${tenantId}`;
}

/**
 * Call after anything that changes a tenant's sales or voucher counts.
 *
 * Never throws: it runs at the end of a sale, from route handlers, from
 * `after()` and from cron jobs, and a cache that could not be cleared must
 * never fail the sale it is reporting. Outside a Next request (a script) it
 * does nothing, which is what a script wants. `expire: 0` so the next read
 * is fresh rather than served stale while it recomputes: the owner who just
 * retried a voucher must see the count drop.
 */
export function invalidateTenantStats(tenantId: string): void {
  try {
    revalidateTag(tenantStatsTag(tenantId), { expire: 0 });
  } catch (error) {
    console.warn(`[stats-cache] could not invalidate tenant ${tenantId}:`, error);
  }
}
