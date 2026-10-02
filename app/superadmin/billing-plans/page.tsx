import { getAllBillingPlans } from "@/lib/billing-plans";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingPlansClient } from "@/components/superadmin/billing-plans-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPlansPage() {
  await requireSuperAdmin();

  const plans = await getAllBillingPlans();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Billing Plans</h1>
        <p className="text-muted-foreground">
          Create and manage the subscription tiers tenants can choose from
        </p>
      </div>

      <BillingPlansClient initialPlans={plans} />
    </div>
  );
}
