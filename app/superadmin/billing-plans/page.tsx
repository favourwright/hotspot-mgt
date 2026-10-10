import { getAllBillingPlans } from "@/lib/billing-plans";
import { getAllAddons } from "@/lib/addons";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingPlansClient } from "@/components/superadmin/billing-plans-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPlansPage() {
  await requireSuperAdmin();

  const [plans, addons] = await Promise.all([
    getAllBillingPlans(),
    getAllAddons(),
  ]);

  return (
    <div className="space-y-6">
      <BillingPlansClient
        initialPlans={plans}
        addons={addons.map((addon) => ({
          key: addon.key,
          name: addon.name,
          pricingModel: addon.pricingModel,
        }))}
      />
    </div>
  );
}
