import { requireTenantOwner } from "@/lib/tenant-context";
import {
  getTenantVouchers,
  getTenantPayments,
} from "@/lib/firestore-helpers";
import { getCachedTenantStats } from "@/lib/stats-cache";
import { StatsCards } from "@/components/admin/stats-cards";
import { RecentPaymentsTable } from "@/components/admin/recent-payments-table";
import { FailedVouchersSummary } from "@/components/admin/failed-vouchers-summary";
import { PageHeader } from "@/components/system/page-header";
import { Toolbar, SearchField } from "@/components/system/toolbar";
import { Button } from "@/components/system/button";
import Link from "next/link";
import { Plus } from "lucide-react";

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  // Both tables below show a fixed number of rows, so the limit belongs in
  // the query -- slicing after the fetch still bills a read per document.
  const [stats, latestPayments, latestFailed] = await Promise.all([
    getCachedTenantStats(tenant.id),
    getTenantPayments(tenant.id, 10),
    getTenantVouchers(tenant.id, "failed", 5),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tenant.businessName}
        description="Dashboard overview"
        action={
          <Button
            tone="action"
            nativeButton={false}
            render={<Link href={`/${tenantSlug}/admin/plans`} />}
          >
            <Plus />
            New plan
          </Button>
        }
      />

      <Toolbar end={<SearchField />} />

      <StatsCards stats={stats} tenantSlug={tenantSlug} />

      {/* `items-start` so a card sizes to its content -- grid stretch
          would otherwise make an empty card as tall as the full one
          beside it, and the centred empty state would float in it. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <RecentPaymentsTable payments={latestPayments} />
        <FailedVouchersSummary
          vouchers={latestFailed}
          tenantSlug={tenantSlug}
        />
      </div>
    </div>
  );
}
