import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { getTenantLocations, getTenantRouters, getTenantPlans } from "@/lib/firestore-helpers";
import { LocationsTable } from "@/components/admin/locations-table";

export default async function TenantLocationsPage({
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

  const [locations, routers, plans] = await Promise.all([
    getTenantLocations(tenant.id),
    getTenantRouters(tenant.id),
    getTenantPlans(tenant.id),
  ]);

  return (
    <div className="p-6">
      <LocationsTable
        initialLocations={locations}
        plans={plans}
        tenantSlug={tenantSlug}
        routers={routers}
      />
    </div>
  );
}
