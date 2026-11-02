import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantLocations, getTenantRouters, getTenantPlans } from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { LocationsTable } from "@/components/admin/locations-table";

export default async function TenantLocationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const [locations, routers, plans, billingPlan] = await Promise.all([
    getTenantLocations(tenant.id),
    getTenantRouters(tenant.id),
    getTenantPlans(tenant.id),
    getBillingPlanById(tenant.planId),
  ]);

  return (
    <div>
      <LocationsTable
        initialLocations={locations}
        plans={plans}
        tenantSlug={tenantSlug}
        routers={routers}
        locationLimit={billingPlan?.limits.maxLocations ?? null}
        planName={billingPlan?.name ?? null}
      />
    </div>
  );
}
