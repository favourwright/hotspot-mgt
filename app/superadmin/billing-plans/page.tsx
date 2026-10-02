import { getAllBillingPlans } from "@/lib/billing-plans";
import { BillingPlansClient } from "@/components/superadmin/billing-plans-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPlansPage() {
  const plans = await getAllBillingPlans();

  return (
    <div className="p-6">
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
