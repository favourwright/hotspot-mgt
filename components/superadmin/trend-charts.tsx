"use client";

import { ChartColumn } from "lucide-react";

import { formatNaira, formatNairaCompact } from "@/lib/utils";
import { shortDate, weekdayDate } from "@/lib/stats-period";
import type { PlatformOverviewStats } from "@/lib/dashboard-stats";
import { ColumnChart } from "@/components/system/charts";
import { TrendCard } from "@/components/system/trend-card";
import { PaceCard } from "@/components/admin/trend-charts";

/**
 * The platform's two trends: income this month against last, and what
 * tenants sold day by day - the volume that commission is a share of.
 *
 * Sales stop at yesterday. They are the sum of every tenant's day, stored by
 * the nightly job; counting today live would be a query per tenant on every
 * load (lib/dashboard-stats.ts).
 */
export function PlatformTrendCharts({ stats }: { stats: PlatformOverviewStats }) {
  const { daily, pace } = stats.trend;
  const nothing = daily.every((d) => !d.figures?.salesKobo);
  const last = daily.length - 1;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <PaceCard
        pace={pace}
        href="/superadmin/reports"
        title="Income so far"
        description="Commission, plans, addons and credits, against last month"
        what="income"
      />
      <TrendCard
        href="/superadmin/reports"
        title="Tenant sales"
        description="What tenants sold each day, to yesterday"
        empty={
          nothing
            ? {
                icon: <ChartColumn />,
                title: "No sales in the last 30 days",
                description: "Tenants' daily sales appear here the morning after.",
              }
            : null
        }
        chart={
          <ColumnChart
            series={[{ key: "salesKobo", label: "Sales", color: "var(--series-1)" }]}
            points={daily.map((d, i) => ({
              key: d.dateKey,
              label: weekdayDate(d.dateKey),
              tick: i === last ? "Yesterday" : shortDate(d.dateKey),
              values: d.figures ? { salesKobo: d.figures.salesKobo } : null,
            }))}
            format={formatNaira}
            axisFormat={formatNairaCompact}
            ariaLabel="Tenants' combined daily sales over the 30 days to yesterday. The report page lists every day."
          />
        }
      />
    </div>
  );
}
