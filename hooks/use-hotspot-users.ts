import { useQuery } from "@tanstack/react-query";
import { hotspotService } from "@/services/admin-service";

export const HOTSPOT_USERS_QUERY_KEY = (locationId: string) => [
  "hotspot-users",
  locationId,
];

/**
 * The reconciled user list. Deliberately not polled: it changes when a
 * voucher is sold or a user is removed, so it is refetched on those events
 * (and on demand) rather than on a timer. See useActiveSessions for the one
 * thing that genuinely is live.
 */
export function useHotspotUsers(locationId: string | null) {
  return useQuery({
    queryKey: HOTSPOT_USERS_QUERY_KEY(locationId ?? ""),
    queryFn: () => hotspotService.getUsers(locationId!),
    enabled: Boolean(locationId),
    staleTime: 60 * 1000,
  });
}
