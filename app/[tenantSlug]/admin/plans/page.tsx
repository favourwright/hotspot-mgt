import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantPlans, getTenantLocations } from "@/lib/firestore-helpers";
import { PlansTable } from "@/components/admin/plans-table";

export default async function TenantPlansPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const [plans, locations] = await Promise.all([
    getTenantPlans(tenant.id),
    getTenantLocations(tenant.id),
  ]);

  return (
    <div className="p-6">
      <PlansTable
        initialPlans={plans}
        initialLocations={locations}
        tenantSlug={tenantSlug}
      />
    </div>
  );
}
