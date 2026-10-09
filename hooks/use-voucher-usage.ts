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
    retry: false,
  });
}
