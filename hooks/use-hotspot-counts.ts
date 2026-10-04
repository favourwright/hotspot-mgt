import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { HotspotCounts } from "@/lib/hotspot-counts";

export const HOTSPOT_COUNTS_QUERY_KEY = ["hotspot-counts"];

/**
 * Router-backed dashboard tiles. Loaded from the client, never in the
 * page's server render: these totals come from hardware in a shop behind a
 * WireGuard tunnel, and the dashboard must not be as slow, or as likely to
 * fail, as the least reachable router.
 */
export function useHotspotCounts() {
  return useQuery({
    queryKey: HOTSPOT_COUNTS_QUERY_KEY,
    queryFn: async (): Promise<HotspotCounts> => {
      const response = await apiClient.get("/api/admin/hotspot-counts");
      return response.data;
    },
    staleTime: 30 * 1000,
  });
}
