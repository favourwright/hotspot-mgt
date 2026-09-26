import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { getTenantPlans, getTenantLocations } from "@/lib/firestore-helpers";
import { PlansTable } from "@/components/admin/plans-table";

export default async function TenantPlansPage({
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
