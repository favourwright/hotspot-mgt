import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { getTenantRouters } from "@/lib/firestore-helpers";
import { RoutersTable } from "@/components/admin/routers-table";

export default async function TenantRoutersPage({
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

  const routers = await getTenantRouters(tenant.id);

  return (
    <div className="p-6">
      <RoutersTable initialRouters={routers} tenantSlug={tenantSlug} />
    </div>
  );
}
