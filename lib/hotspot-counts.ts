import { unstable_cache } from "next/cache";
import { countActiveSessions, countHotspotUsers } from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import { getTenantLocations } from "@/lib/firestore-helpers";

export interface HotspotCounts {
  users: number;
  activeNow: number;
  locationsTotal: number;
  locationsReachable: number;
}

/**
 * Totals across every location a tenant has, for the dashboard tiles.
 *
 * Cached briefly so the dashboard does not reach out to each router on
 * every load, or once per viewer. Thirty seconds is short enough that the
 * "active now" tile still feels current and long enough that a refresh
 * loop, or several people with the dashboard open, collapses to one call
 * per router.
 */
const CACHE_SECONDS = 30;

async function collect(tenantId: string): Promise<HotspotCounts> {
  const locations = await getTenantLocations(tenantId);

  const perLocation = await Promise.all(
    locations.map(async (location) => {
      const resolved = await getRouterForLocation(tenantId, location.id);
      if (!resolved) return null;

      // One router being down must not zero the whole figure, so each is
      // settled independently and unreachable ones are reported separately
      // rather than silently counted as zero.
      const [users, active] = await Promise.all([
        countHotspotUsers(resolved.config),
        countActiveSessions(resolved.config),
      ]);

      if (!users.success || !active.success) return null;
      return { users: users.data ?? 0, activeNow: active.data ?? 0 };
    })
  );

  const reachable = perLocation.filter((r) => r !== null);

  return {
    users: reachable.reduce((sum, r) => sum + r.users, 0),
    activeNow: reachable.reduce((sum, r) => sum + r.activeNow, 0),
    locationsTotal: locations.length,
    locationsReachable: reachable.length,
  };
}

export async function getHotspotCounts(tenantId: string): Promise<HotspotCounts> {
  return unstable_cache(() => collect(tenantId), ["hotspot-counts", tenantId], {
    revalidate: CACHE_SECONDS,
  })();
}
