import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { getTenantVouchers } from "@/lib/firestore-helpers";
import { VouchersClient } from "@/components/admin/vouchers-client";

export default async function TenantVouchersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  const vouchers = await getTenantVouchers(tenant.id);

  return (
    <div className="p-6">
      <VouchersClient
        initialVouchers={vouchers}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
