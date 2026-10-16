import { requireTenantOwner } from "@/lib/tenant-context";
import {
  NO_VOUCHER_FILTERS,
  VOUCHERS_PAGE_SIZE,
  getVoucherTotals,
  queryVouchers,
} from "@/lib/vouchers-list";
import { VouchersClient } from "@/components/admin/vouchers-client";

export default async function TenantVouchersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // The first page and its totals, server-rendered so the table and the
  // cards are right on first paint. Everything after this - turning a page,
  // changing a filter, a lookup - goes through /api/admin/vouchers.
  //
  // Deliberately ignores any filter in the URL, for the reason the
  // transactions page spells out: reading them here re-runs this route on
  // every keystroke, which is what the client's history.replaceState exists
  // to avoid.
  const [page, totals] = await Promise.all([
    queryVouchers({ tenantId: tenant.id, filters: NO_VOUCHER_FILTERS }),
    getVoucherTotals({ tenantId: tenant.id, filters: NO_VOUCHER_FILTERS }),
  ]);

  return (
    <VouchersClient
      initialVouchers={page.vouchers}
      initialCursor={page.nextCursor}
      initialTotals={totals}
      pageSize={VOUCHERS_PAGE_SIZE}
    />
  );
}
