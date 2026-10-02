import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantVouchers } from "@/lib/firestore-helpers";
import { FailedVouchersClient } from "@/components/admin/failed-vouchers-client";

export default async function TenantFailedPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const failedVouchers = await getTenantVouchers(tenant.id, "failed");

  return (
    <div>
      <FailedVouchersClient
        initialVouchers={failedVouchers}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
