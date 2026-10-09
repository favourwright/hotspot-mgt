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
import { MapPin, Plus, ServerCog } from "lucide-react";
import { tenantBasePath } from "@/lib/tenant-url";

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

  const base = tenantBasePath(tenantSlug);

  // A plan can't exist without a location, and a location can't exist
  // without a router -- so the single action here is whichever link in that
  // chain is missing, not an invitation to create a plan that would fail.
  const nextStep =
    stats.routerCount === 0
      ? {
          label: "Register router",
          href: `${base}/admin/routers`,
          icon: ServerCog,
          hint: "Start by registering your first MikroTik router",
        }
      : stats.locationCount === 0
        ? {
            label: "Add location",
            href: `${base}/admin/locations`,
            icon: MapPin,
            hint: "Add a location to the router you registered",
          }
        : {
            label: stats.planCount === 0 ? "Add plan" : "New plan",
            href: `${base}/admin/plans`,
            icon: Plus,
            hint:
              stats.planCount === 0
                ? "Create a plan so customers can start buying vouchers"
                : "Dashboard overview",
          };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Business overview"
        description={nextStep.hint}
        action={
          <Button
            tone="action"
            nativeButton={false}
            render={<Link href={nextStep.href} />}
          >
            <nextStep.icon />
            {nextStep.label}
          </Button>
        }
      />

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
