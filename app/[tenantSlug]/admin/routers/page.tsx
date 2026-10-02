import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantRouters } from "@/lib/firestore-helpers";
import { RoutersTable } from "@/components/admin/routers-table";

export default async function TenantRoutersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const routers = await getTenantRouters(tenant.id);

  return (
    <div>
      <RoutersTable initialRouters={routers} tenantSlug={tenantSlug} />
    </div>
  );
}
