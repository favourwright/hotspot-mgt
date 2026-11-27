import { unstable_cache } from "next/cache";
import {
  getPlatformRevenue,
  getPlatformStats,
  getTenantEarnings,
} from "@/lib/firestore-helpers";
import { getPlatformOverview, getTenantStats } from "@/lib/dashboard-stats";
import { tenantStatsTag } from "@/lib/stats-invalidate";

export { invalidateTenantStats } from "@/lib/stats-invalidate";

/**
 * Dashboard figures, cached on the server.
 *
 * The overview pages used to recompute on a 60s timer, and the client's
 * refetch on window focus went through an uncached route, so a tenant
 * tabbing back to the dashboard paid nine-odd reads each time whether or
 * not anything had been sold. Reads scaled with page views.
 *
 * Now the tenant's figures are tagged and cleared by whatever changes them -
 * a sale, a retry, a generated code's first use (`invalidateTenantStats`) -
 * so they recompute after a sale and otherwise stay cached. The timer is
 * only the backstop for changes nothing invalidates: a voucher expiring, a
 * router added. Both the page and /api/admin/stats read through here, which
 * is safe because the writers clear the tag before the client refetches.
 */
const TENANT_STATS_SECONDS = 5 * 60;

/** Superadmin figures: one reader, across every tenant, so no tag to clear. */
const PLATFORM_STATS_SECONDS = 5 * 60;

/** The billing page's lifetime figures. */
const BILLING_STATS_SECONDS = 60;

export async function getCachedTenantStats(tenantId: string) {
  return unstable_cache(
    () => getTenantStats(tenantId),
    ["tenant-stats-v2", tenantId],
    { tags: [tenantStatsTag(tenantId)], revalidate: TENANT_STATS_SECONDS }
  )();
}

export async function getCachedPlatformOverview() {
  return unstable_cache(() => getPlatformOverview(), ["platform-overview"], {
    revalidate: PLATFORM_STATS_SECONDS,
  })();
}

/** Lifetime and today's commission, for the superadmin billing page. */
export async function getCachedPlatformStats() {
  return unstable_cache(getPlatformStats, ["platform-stats"], {
    revalidate: BILLING_STATS_SECONDS,
  })();
}

/** The revenue ledger's totals for the superadmin billing page. */
export async function getCachedPlatformRevenue() {
  return unstable_cache(getPlatformRevenue, ["platform-revenue"], {
    revalidate: BILLING_STATS_SECONDS,
  })();
}

/**
 * Per-tenant voucher earnings for the superadmin billing page.
 *
 * Keyed on the tenant id set rather than cached per tenant: the billing page
 * always wants the whole table, and one entry covering all of it means one
 * cache miss per minute instead of one per tenant. Onboarding a tenant
 * changes the key, which is correct - the new tenant has to appear.
 *
 * The billing page's headline commission comes from `getCachedPlatformStats`
 * rather than being re-derived from this map, so its cards cost one set of
 * reads, not two.
 */
export async function getCachedTenantEarnings(tenantIds: string[]) {
  const key = [...tenantIds].sort().join(",");

  return unstable_cache(
    () => getTenantEarnings(tenantIds),
    ["tenant-earnings", key],
    { revalidate: BILLING_STATS_SECONDS }
  )();
}
