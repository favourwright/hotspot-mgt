import { getAllTenants } from "@/lib/firestore-helpers";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingClient } from "@/components/superadmin/billing-client";
import { PageHeader } from "@/components/system/page-header";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPage() {
  await requireSuperAdmin();

  const tenants = await getAllTenants();

  // Filter tenants with subscriptions
  const subscriptionTenants = tenants.filter((t) => t.monthlyFee > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Subscription and billing status"
      />

      <BillingClient tenants={subscriptionTenants} />
    </div>
  );
}
