import { useQuery } from "@tanstack/react-query";
import { hotspotService } from "@/services/admin-service";

export const HOTSPOT_USER_DETAIL_QUERY_KEY = (
  locationId: string,
  username: string
) => ["hotspot-user-detail", locationId, username];

/**
 * Loaded only while the detail dialog is open (`enabled`), so the password
 * and byte counters are fetched for the one user being inspected rather
 * than for every row of the table.
 */
export function useHotspotUserDetail(
  locationId: string | null,
  username: string | null
) {
  return useQuery({
    queryKey: HOTSPOT_USER_DETAIL_QUERY_KEY(locationId ?? "", username ?? ""),
    queryFn: () => hotspotService.getUserDetail(locationId!, username!),
    enabled: Boolean(locationId && username),
    staleTime: 15 * 1000,
  });
}
