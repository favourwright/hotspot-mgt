import { requireSuperAdmin } from "@/lib/server-auth";
import { getCachedPlatformReport } from "@/lib/stats-cache";
import { resolveReportMonth } from "@/lib/reports";
import { displayZoneDateKey } from "@/lib/utils";
import { monthKeyOf } from "@/lib/stats-period";
import { PlatformReportView } from "@/components/superadmin/report-view";

export const dynamic = "force-dynamic";

/**
 * A month of the platform in full: the page the overview's trend charts
 * link to. `?month=YYYY-MM`, one of the last twelve. Built in lib/reports.ts.
 */
export default async function SuperAdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireSuperAdmin();
  const { month: requested } = await searchParams;
  const month = resolveReportMonth(requested);
  const report = await getCachedPlatformReport(month);

  return <PlatformReportView report={report} currentMonth={monthKeyOf(displayZoneDateKey())} />;
}
