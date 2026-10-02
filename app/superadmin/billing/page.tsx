import { getAllTenants } from "@/lib/firestore-helpers";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingClient } from "@/components/superadmin/billing-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPage() {
  await requireSuperAdmin();

  const tenants = await getAllTenants();

  // Filter tenants with subscriptions
  const subscriptionTenants = tenants.filter((t) => t.monthlyFee > 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground">
          Subscription and billing status
        </p>
      </div>

      <BillingClient tenants={subscriptionTenants} />
    </div>
  );
}
