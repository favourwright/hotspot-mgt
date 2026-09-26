import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { TenantVoucherDisplay } from "@/components/tenant/voucher-display";

interface TenantVoucherPageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ id?: string }>;
}

export default async function TenantVoucherPage({
  params,
  searchParams,
}: TenantVoucherPageProps) {
  const { tenantSlug } = await params;
  const { id } = await searchParams;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  if (!id) {
    notFound();
  }

  return (
    <TenantVoucherDisplay
      tenantId={tenant.id}
      tenantSlug={tenant.slug}
      businessName={tenant.businessName}
      voucherId={id}
    />
  );
}
