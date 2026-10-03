import { getAllBillingPlans } from "@/lib/billing-plans";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingPlansClient } from "@/components/superadmin/billing-plans-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPlansPage() {
  await requireSuperAdmin();

  const plans = await getAllBillingPlans();

  return (
    <div className="space-y-6">
      <BillingPlansClient initialPlans={plans} />
    </div>
  );
}
