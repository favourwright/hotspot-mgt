import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { vouchersService } from "@/services/admin-service";
import { Voucher } from "@/types/schemas";
import { STATS_QUERY_KEY } from "@/hooks/use-stats";

export const FAILED_VOUCHERS_QUERY_KEY = ["failed-vouchers"];

export function useFailedVouchers(initialData?: Voucher[]) {
  return useQuery({
    queryKey: FAILED_VOUCHERS_QUERY_KEY,
    queryFn: () => vouchersService.getAll("failed"),
    initialData,
  });
}

export function useRetryVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (voucherId: string) => vouchersService.retry(voucherId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FAILED_VOUCHERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
    },
  });
}
