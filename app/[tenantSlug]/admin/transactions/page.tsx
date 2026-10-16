import { requireTenantOwner } from "@/lib/tenant-context";
import {
  getTransactionTotals,
  queryTransactions,
  TRANSACTIONS_PAGE_SIZE,
} from "@/lib/transactions";
import { TransactionsClient } from "@/components/admin/transactions-client";

export default async function TenantTransactionsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // The first page and its totals, server-rendered so the table and the
  // cards are right on first paint. Everything after this - turning a page,
  // changing a filter, a lookup - goes through /api/admin/transactions.
  //
  // Deliberately ignores any filter in the URL: reading them here would mean
  // this route re-runs on every keystroke, which is the thing the client's
  // `history.replaceState` was written to avoid. The client refetches for
  // itself when a filter is actually set.
  const noFilters = { status: null, from: null, to: null };

  const [page, totals] = await Promise.all([
    queryTransactions({ tenantId: tenant.id, filters: noFilters }),
    getTransactionTotals({ tenantId: tenant.id, filters: noFilters }),
  ]);

  return (
    <TransactionsClient
      initialPayments={page.payments}
      initialCursor={page.nextCursor}
      initialTotals={totals}
      pageSize={TRANSACTIONS_PAGE_SIZE}
    />
  );
}
