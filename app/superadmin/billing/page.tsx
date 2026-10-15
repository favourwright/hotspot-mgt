import { getAllTenants } from "@/lib/firestore-helpers";
import { getCachedPlatformStats, getCachedTenantEarnings } from "@/lib/stats-cache";
import { requireSuperAdmin } from "@/lib/server-auth";
import { BillingClient } from "@/components/superadmin/billing-client";
import { getTenantIdsWithActiveWaiver } from "@/lib/fee-waivers";
import { PageHeader } from "@/components/system/page-header";

export const dynamic = "force-dynamic";

export default async function SuperAdminBillingPage() {
  await requireSuperAdmin();

  // Every tenant, not just the ones on a flat fee. A tenant on a free or
  // usage-only plan still earns the platform money on every voucher their
  // customers buy - filtering on `monthlyFee > 0` hid exactly those from the
  // one page that is supposed to show what each tenant is worth.
  const [tenants, stats] = await Promise.all([
    getAllTenants(),
    // Shares a cache entry with the superadmin overview, so opening both
    // pages within the TTL costs one set of reads.
    getCachedPlatformStats(),
  ]);

  const earnings = await getCachedTenantEarnings(tenants.map((t) => t.id));

  // The MRR figure above is a Firestore sum over `monthlyFee`, which a
  // waiver does not touch. Without this the page would report comped and
  // trialling tenants as subscription revenue being collected.
  const waivedTenantIds = [...(await getTenantIdsWithActiveWaiver())];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="What each tenant pays the platform, and what they earn it"
      />

      <BillingClient
        tenants={tenants}
        earnings={earnings}
        waivedTenantIds={waivedTenantIds}
        mrr={stats.mrr}
        lifetimeCommission={stats.totalRevenueAllTenants}
        todayCommission={stats.todayRevenueAllTenants}
      />
    </div>
  );
}
