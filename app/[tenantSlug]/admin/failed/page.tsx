import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { getTenantVouchers } from "@/lib/firestore-helpers";
import { FailedVouchersClient } from "@/components/admin/failed-vouchers-client";

export default async function TenantFailedPage({
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

  const failedVouchers = await getTenantVouchers(tenant.id, "failed");

  return (
    <div className="p-6">
      <FailedVouchersClient
        initialVouchers={failedVouchers}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
