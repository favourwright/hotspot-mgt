import { unstable_cache } from "next/cache";
import { getPlatformStats, getTenantStats } from "@/lib/firestore-helpers";

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
