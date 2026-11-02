import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api-client";
import type { CustomerVoucher } from "@/lib/customer-voucher";

/**
 * A customer's own vouchers, from the API rather than a Firestore listener.
 *
 * A voucher's status changes rarely and nobody is waiting on the second it does,
 * so a minute's poll while the tab is in front, plus a refetch on returning to
 * it, is the same experience for what the Firestore SDK used to cost in bundle
 * weight on the captive portal's slowest connections. As in useVoucherUsage, the
 * interval stopping in the background is load-bearing: each tick is a read.
 */
const POLL_MS = 60 * 1000;

const isFinished = (status?: CustomerVoucher["status"]) =>
  status === "expired" || status === "superseded";

export function useCustomerVouchers(tenantId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["customer-vouchers", tenantId],
    queryFn: async (): Promise<CustomerVoucher[]> => {
      const response = await apiClient.get(
        `/api/voucher/mine?tenantId=${encodeURIComponent(tenantId)}`
      );
      return response.data;
    },
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

export function useCustomerVoucher(
  voucherId: string,
  tenantId: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["customer-voucher", tenantId, voucherId],
    queryFn: async (): Promise<CustomerVoucher> => {
      const response = await apiClient.get(
        `/api/voucher/${encodeURIComponent(voucherId)}?tenantId=${encodeURIComponent(tenantId)}`
      );
      return response.data;
    },
    enabled,
    staleTime: 30 * 1000,
    // Nothing further happens to a voucher that has run out or been renewed.
    refetchInterval: (query) =>
      isFinished(query.state.data?.status) ? false : POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
