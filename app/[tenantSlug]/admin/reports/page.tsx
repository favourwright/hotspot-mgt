import { requireTenantOwner } from "@/lib/tenant-context";
import { getCachedTenantReport } from "@/lib/stats-cache";
import { resolveReportMonth } from "@/lib/reports";
import { displayZoneDateKey } from "@/lib/utils";
import { monthKeyOf } from "@/lib/stats-period";
import { TenantReportView } from "@/components/admin/report-view";

/**
 * A month of the tenant's sales in full: the page the dashboard's trend
 * charts link to. The month is `?month=YYYY-MM`, one of the last twelve;
 * anything else shows this month. Built in lib/reports.ts.
 */
export default async function TenantReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ tenantSlug }, { month: requested }] = await Promise.all([params, searchParams]);
  const tenant = await requireTenantOwner(tenantSlug);

  const month = resolveReportMonth(requested);
  const report = await getCachedTenantReport(tenant.id, month);

  return (
    <TenantReportView
      report={report}
      currentMonth={monthKeyOf(displayZoneDateKey())}
    />
  );
}
