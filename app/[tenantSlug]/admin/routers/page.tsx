import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantRouters } from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { RoutersTable } from "@/components/admin/routers-table";

export default async function TenantRoutersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const [routers, billingPlan] = await Promise.all([
    getTenantRouters(tenant.id),
    getBillingPlanById(tenant.planId),
  ]);

  return (
    <div>
      <RoutersTable
        initialRouters={routers}
        tenantSlug={tenantSlug}
        routerLimit={billingPlan?.limits.maxRouters ?? null}
        planName={billingPlan?.name ?? null}
      />
    </div>
  );
}
