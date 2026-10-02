import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantVouchers } from "@/lib/firestore-helpers";
import { VouchersClient } from "@/components/admin/vouchers-client";

export default async function TenantVouchersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const vouchers = await getTenantVouchers(tenant.id);

  return (
    <div>
      <VouchersClient
        initialVouchers={vouchers}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
