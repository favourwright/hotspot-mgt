import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { TenantVouchersClient } from "@/components/tenant/vouchers-client";

interface TenantVouchersPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantVouchersPage({
  params,
}: TenantVouchersPageProps) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  return (
    <TenantVouchersClient
      tenantId={tenant.id}
      tenantSlug={tenant.slug}
      businessName={tenant.businessName}
    />
  );
}
