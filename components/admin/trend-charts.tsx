"use client";

import { ChartColumn } from "lucide-react";

import { formatNaira, formatNairaCompact } from "@/lib/utils";
import { dateKeyFor, monthName, shortDate, weekdayDate } from "@/lib/stats-period";
import { useAdminStats } from "@/hooks/use-stats";
import type { AdminStats } from "@/services/admin-service";
import type { PaceSeries } from "@/lib/dashboard-stats";
import { tenantBasePath } from "@/lib/tenant-url";
import { ChartLegend, ColumnChart, LineChart, type ChartSeries } from "@/components/system/charts";
import { TrendCard } from "@/components/system/trend-card";

/**
 * The tenant dashboard's two trends, under the figures they explain.
 *
 * "Month so far" is this month's running revenue against last month's whole
 * curve: whether the month is ahead or behind is the question the revenue
 * card raises and cannot answer. "Last 30 days" is the daily shape behind
 * it, stacked online and cash. Both come with the stats the cards already
 * fetch (lib/dashboard-stats.ts), so they cost no reads of their own.
 */
export function TenantTrendCharts({
  stats: initialStats,
  tenantSlug,
}: {
  stats: AdminStats;
  tenantSlug: string;
}) {
  // Same query as the cards, so a retry or a sale refreshes both together.
  const { data: stats = initialStats, isFetching } = useAdminStats(initialStats);
  const { daily, pace } = stats.trend;
  const report = `${tenantBasePath(tenantSlug)}/admin/reports`;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <PaceCard pace={pace} href={report} refreshing={isFetching} />
      <DailyCard daily={daily} href={report} refreshing={isFetching} />
    </div>
  );
}

export function PaceCard({
  pace,
  href,
  title = "Month so far",
  description = "Revenue to date, against last month",
  what = "revenue",
  refreshing,
}: {
  pace: PaceSeries;
  /** The report page with the figures behind the chart. */
  href: string;
  title?: string;
  description?: string;
  /** For the empty state and the chart's accessible name. */
  what?: string;
  refreshing?: boolean;
}) {
  const thisName = monthName(pace.thisMonthKey);
  const lastName = monthName(pace.lastMonthKey);
  const count = Math.max(pace.thisMonth.length, pace.lastMonth.length);
  const series = [
    {
      key: "last",
      label: lastName,
      color: "var(--series-muted)",
      values: pace.lastMonth,
    },
    {
      key: "this",
      label: thisName,
      color: "var(--series-1)",
      values: pace.thisMonth,
      emphasis: true,
    },
  ];
  const nothing = [...pace.thisMonth, ...pace.lastMonth].every((v) => !v);
  const day = (i: number) => i + 1;

  return (
    <TrendCard
      href={href}
      title={title}
      description={description}
      refreshing={refreshing}
      empty={
        nothing
          ? {
              icon: <ChartColumn />,
              title: `No ${what} yet`,
              description: `The running total for ${thisName} appears here with the first sale.`,
            }
          : null
      }
      // Ordered as the lines are read: the month in question, then the
      // one it is measured against.
      legend={<ChartLegend shape="line" series={[...series].reverse()} />}
      chart={
        <LineChart
          series={series}
          count={count}
          tick={(i) => String(day(i))}
          pointLabel={(i) =>
            `${shortDate(dateKeyFor(pace.thisMonthKey, day(i)))} vs ${shortDate(dateKeyFor(pace.lastMonthKey, day(i)))}`
          }
          format={formatNaira}
          axisFormat={formatNairaCompact}
          ariaLabel={`Running ${what} total for ${thisName}, against ${lastName}, by day of the month. The report page lists every day.`}
        />
      }
    />
  );
}

function DailyCard({
  daily,
  href,
  refreshing,
}: {
  daily: AdminStats["trend"]["daily"];
  href: string;
  refreshing?: boolean;
}) {
  const anyCash = daily.some((d) => (d.figures?.cashKobo ?? 0) > 0);
  // Cash appears only once a tenant has sold a printed code in the window:
  // until then a second, always-empty series is noise.
  const series: ChartSeries[] = [
    { key: "onlineKobo", label: "Online", color: "var(--series-1)" },
    ...(anyCash ? [{ key: "cashKobo", label: "Cash", color: "var(--series-2)" }] : []),
  ];
  const nothing = daily.every((d) => !d.figures || d.figures.onlineKobo + d.figures.cashKobo === 0);
  const last = daily.length - 1;

  return (
    <TrendCard
      href={href}
      title="Last 30 days"
      description={anyCash ? "Daily revenue, online and cash" : "Daily revenue"}
      refreshing={refreshing}
      empty={
        nothing
          ? {
              icon: <ChartColumn />,
              title: "No sales in the last 30 days",
              description: "Each day's revenue appears here as customers buy vouchers.",
            }
          : null
      }
      legend={series.length > 1 ? <ChartLegend shape="block" series={series} /> : null}
      chart={
        <ColumnChart
          series={series}
          points={daily.map((d, i) => ({
            key: d.dateKey,
            label: weekdayDate(d.dateKey),
            tick: i === last ? "Today" : shortDate(d.dateKey),
            values: d.figures ? { onlineKobo: d.figures.onlineKobo, cashKobo: d.figures.cashKobo } : null,
            note: d.partial ? "So far today" : undefined,
          }))}
          format={formatNaira}
          axisFormat={formatNairaCompact}
          ariaLabel="Daily revenue over the last 30 days. The report page lists every day."
        />
      }
    />
  );
}
