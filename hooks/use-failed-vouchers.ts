import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vouchersService } from "@/services/admin-service";
import { STATS_QUERY_KEY } from "@/hooks/use-stats";

/**
 * Retrying a failed voucher.
 *
 * There is deliberately no `useFailedVouchers` query beside this any more.
 * The failed queue is paged now (lib/vouchers-list.ts), and a TanStack query
 * holding "the failed vouchers" cannot represent a page of them without
 * either caching the wrong page under the right key or refetching page one
 * after a retry performed on page three. The client owns its own page state
 * and reloads the page it is actually on - which is also what the
 * transactions list does.
 *
 * The dashboard's failed count does still subscribe, so that invalidation
 * has something behind it. Invalidating a key nothing subscribes to is the
 * silent no-op documented in docs/architecture.md.
 */
export function useRetryVoucher() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (voucherId: string) => vouchersService.retry(voucherId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATS_QUERY_KEY });
    },
  });
}
