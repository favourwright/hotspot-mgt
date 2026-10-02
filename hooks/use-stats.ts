import { useQuery } from "@tanstack/react-query";
import { statsService, AdminStats } from "@/services/admin-service";

export const STATS_QUERY_KEY = ["admin", "stats"];

export function useAdminStats(initialData?: AdminStats) {
  return useQuery({
    queryKey: STATS_QUERY_KEY,
    queryFn: statsService.get,
    staleTime: 2 * 60 * 1000, // 2 minutes - stats don't need to be super fresh
    initialData,
  });
}

// Alias for backward compatibility
export { useAdminStats as useStats };
