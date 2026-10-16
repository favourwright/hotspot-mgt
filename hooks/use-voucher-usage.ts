import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";
import type { VoucherUsage } from "@/app/api/voucher/[id]/usage/route";

export const VOUCHER_USAGE_QUERY_KEY = (voucherId: string) => [
  "voucher-usage",
  voucherId,
];

/**
 * A customer's own consumption for one voucher, read live from the router.
 *
 * Only enabled for a voucher that could plausibly have usage -- asking the
 * router about a failed or expired one costs a round trip to answer
 * "nothing". Refetched on an interval so someone watching their remaining
 * data while connected sees it move.
 *
 * That interval runs only while the tab is in front, which is TanStack's
 * default and is left explicit here because it is load-bearing rather than
 * incidental: each tick costs a Firestore read for the ownership check, and
 * a customer who buys a voucher and leaves the page open on their phone
 * would otherwise poll all day for numbers nobody is looking at. The same
 * reasoning as useActiveSessions, where it is also what saves the most.
 */
export function useVoucherUsage(
  voucherId: string | null,
  tenantId: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: VOUCHER_USAGE_QUERY_KEY(voucherId ?? ""),
    queryFn: async (): Promise<VoucherUsage> => {
      const response = await apiClient.get(
        `/api/voucher/${voucherId}/usage?tenantId=${encodeURIComponent(tenantId!)}`
      );
      return response.data;
    },
    enabled: Boolean(voucherId && tenantId && enabled),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
