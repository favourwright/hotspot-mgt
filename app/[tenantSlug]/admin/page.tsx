import { requireTenantOwner } from "@/lib/tenant-context";
import {
  getTenantStats,
  getTenantVouchers,
  getTenantPayments,
} from "@/lib/firestore-helpers";
import { StatsCards } from "@/components/admin/stats-cards";
import { RecentPaymentsTable } from "@/components/admin/recent-payments-table";
import { FailedVouchersSummary } from "@/components/admin/failed-vouchers-summary";

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const [stats, recentPayments, failedVouchers] = await Promise.all([
    getTenantStats(tenant.id),
    getTenantPayments(tenant.id),
    getTenantVouchers(tenant.id, "failed"),
  ]);

  const latestPayments = recentPayments.slice(0, 10);
  const latestFailed = failedVouchers.slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">{tenant.businessName}</h1>
        <p className="text-muted-foreground">Dashboard overview</p>
      </div>

      <StatsCards stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentPaymentsTable payments={latestPayments} />
        <FailedVouchersSummary
          vouchers={latestFailed}
          tenantSlug={tenantSlug}
        />
      </div>
    </div>
  );
}
