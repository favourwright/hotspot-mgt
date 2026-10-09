import { unstable_cache } from "next/cache";
import {
  getPlatformStats,
  getTenantStats,
  getTenantEarnings,
} from "@/lib/firestore-helpers";

/**
 * Dashboard figures cached for a minute.
 *
 * Nobody can tell that "revenue this month" is 60 seconds old, but the
 * difference in cost is large: ten people opening the dashboard, or one
 * person refreshing ten times (or saving a file ten times in `next dev`,
 * which re-renders these pages), now costs what a single load costs.
 *
 * Deliberately applied at the page level only. The /api/admin/stats and
 * /api/superadmin/stats routes keep calling the uncached helpers, because
 * the client refetches those right after an action that changes the numbers
 * - e.g. retrying a failed voucher - and must see the result, not a cached
 * copy from before the retry.
 */
const STATS_CACHE_SECONDS = 60;

export async function getCachedPlatformStats() {
  return unstable_cache(getPlatformStats, ["platform-stats"], {
    revalidate: STATS_CACHE_SECONDS,
  })();
}

export async function getCachedTenantStats(tenantId: string) {
  return unstable_cache(
    () => getTenantStats(tenantId),
    ["tenant-stats", tenantId],
    { revalidate: STATS_CACHE_SECONDS }
  )();
}

/**
 * Per-tenant voucher earnings for the superadmin billing page.
 *
 * Keyed on the tenant id set rather than cached per tenant: the billing page
 * always wants the whole table, and one entry covering all of it means one
 * cache miss per minute instead of one per tenant. Onboarding a tenant
 * changes the key, which is correct - the new tenant has to appear.
 *
 * Note that the superadmin *overview* already sums platform share across all
 * tenants via `getCachedPlatformStats`. The billing page reuses that for its
 * headline cards rather than re-deriving them from this map, so visiting
 * both pages inside the TTL costs one set of reads, not two.
 */
export async function getCachedTenantEarnings(tenantIds: string[]) {
  const key = [...tenantIds].sort().join(",");

  return unstable_cache(
    () => getTenantEarnings(tenantIds),
    ["tenant-earnings", key],
    { revalidate: STATS_CACHE_SECONDS }
  )();
}
