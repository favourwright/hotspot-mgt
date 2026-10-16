import { requireTenantOwner } from "@/lib/tenant-context";
import {
  FAILED_PAGE_SIZE,
  getVoucherCount,
  queryVouchers,
} from "@/lib/vouchers-list";
import { FailedVouchersClient } from "@/components/admin/failed-vouchers-client";

/** The queue is one status by definition, so the filter is fixed here. */
const FAILED_ONLY = { status: "failed" as const, from: null, to: null };

export default async function TenantFailedPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // First page plus the real total, so "12 vouchers need attention" is the
  // whole queue rather than however many fit on this page. It used to be
  // the length of an array holding every failed voucher ever.
  const [page, total] = await Promise.all([
    queryVouchers({
      tenantId: tenant.id,
      filters: FAILED_ONLY,
      pageSize: FAILED_PAGE_SIZE,
    }),
    getVoucherCount({ tenantId: tenant.id, filters: FAILED_ONLY }),
  ]);

  return (
    <FailedVouchersClient
      initialVouchers={page.vouchers}
      initialCursor={page.nextCursor}
      initialTotal={total}
      pageSize={FAILED_PAGE_SIZE}
    />
  );
}
