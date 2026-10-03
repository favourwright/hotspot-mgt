import { useCallback, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hotspotService } from "@/services/admin-service";

export const ACTIVE_SESSIONS_QUERY_KEY = (locationId: string) => [
  "active-sessions",
  locationId,
];

const BASE_INTERVAL_MS = 15_000;
/**
 * An unreachable router should get quieter, not louder: each consecutive
 * failure doubles the wait, up to two minutes. Hammering a device that is
 * off just burns timeouts and tells the user nothing new.
 */
const MAX_INTERVAL_MS = 120_000;
/** Stop polling entirely after this many consecutive failures. */
const GIVE_UP_AFTER = 5;

/**
 * Live sessions. `live` is the user's Live toggle; polling also stops on its
 * own when the tab is backgrounded, which TanStack does by default
 * (refetchIntervalInBackground is false) and which is most of the saving.
 *
 * Note the failure count is tracked here rather than read off the query:
 * an unreachable router still answers 200 (the route reports it in the
 * body), so TanStack sees a success and its own error counters stay at zero.
 */
export function useActiveSessions(locationId: string | null, live: boolean) {
  const [failures, setFailures] = useState(0);
  const failuresRef = useRef(0);

  const query = useQuery({
    queryKey: ACTIVE_SESSIONS_QUERY_KEY(locationId ?? ""),
    queryFn: async () => {
      const result = await hotspotService.getActiveSessions(locationId!);
      failuresRef.current = result.reachable ? 0 : failuresRef.current + 1;
      setFailures(failuresRef.current);
      return result;
    },
    enabled: Boolean(locationId),
    refetchInterval: () => {
      if (!live || failuresRef.current >= GIVE_UP_AFTER) return false;
      if (failuresRef.current === 0) return BASE_INTERVAL_MS;
      return Math.min(
        BASE_INTERVAL_MS * 2 ** failuresRef.current,
        MAX_INTERVAL_MS
      );
    },
    staleTime: 0,
  });

  const resume = useCallback(() => {
    failuresRef.current = 0;
    setFailures(0);
    query.refetch();
  }, [query]);

  return {
    ...query,
    /** Polling stopped on its own because the router kept not answering. */
    gaveUp: failures >= GIVE_UP_AFTER,
    /** Clears the failure count and resumes polling. */
    resume,
  };
}
