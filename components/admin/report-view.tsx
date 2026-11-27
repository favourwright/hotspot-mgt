"use client";

import { CalendarCheck, ChartColumn, DollarSign, Ticket, TrendingUp } from "lucide-react";

import { cn, formatNaira, formatNairaCompact } from "@/lib/utils";
import {
  describeChange,
  monthName,
  shortDate,
  weekdayDate,
  type MonthKey,
} from "@/lib/stats-period";
import type { TenantReport } from "@/lib/reports";
import { PageHeader } from "@/components/system/page-header";
import { StatCard } from "@/components/system/stat-card";
import { ChartLegend, ColumnChart, type ChartSeries } from "@/components/system/charts";
import { TrendCard } from "@/components/system/trend-card";
import {
  DayTable,
  FactList,
  MixBar,
  MonthPicker,
  ReportCard,
  monthLabel,
  useReportMonth,
} from "@/components/system/report-parts";

const SERIES: ChartSeries[] = [
  { key: "onlineKobo", label: "Online", color: "var(--series-1)" },
  { key: "cashKobo", label: "Cash", color: "var(--series-2)" },
];

/**
 * A tenant's month in full: what the dashboard's two charts summarise.
 *
 * One filter, the month, above everything it scopes. The figures read top
 * down from the headline to the day: four totals with last month beside
 * them, the month day by day and how it split between online and cash, the
 * year it sits in, then every day as text.
 */
export function TenantReportView({
  report,
  currentMonth,
}: {
  report: TenantReport;
  currentMonth: MonthKey;
}) {
  const { go, pending } = useReportMonth();
  const { totals, comparison, days, history, isCurrent } = report;
  const revenue = totals.onlineKobo + totals.cashKobo;
  const prevRevenue = comparison ? comparison.totals.onlineKobo + comparison.totals.cashKobo : null;

  const known = days.filter((d) => d.figures);
  const dayTotal = (d: (typeof days)[number]) =>
    d.figures ? d.figures.onlineKobo + d.figures.cashKobo : 0;
  const best = known.reduce<(typeof days)[number] | null>(
    (b, d) => (!b || dayTotal(d) > dayTotal(b) ? d : b),
    null
  );
  const daysWithSales = known.filter((d) => dayTotal(d) > 0).length;
  const average = known.length ? revenue / known.length : 0;

  // "vs ₦X by 27 Oct" for the month in progress, "vs ₦X in October" for a
  // finished one.
  const against = (now: number, before: number | null, format: (v: number) => string) => {
    if (before === null || !comparison) return "No earlier month to compare";
    if (comparison.throughKey) return describeChange(now, before, comparison.throughKey, format);
    const line = describeChange(now, before, `${comparison.month}-01`, format);
    return line.replace(/ by .*$/, ` in ${monthName(comparison.month)}`);
  };

  const anyCash = days.some((d) => (d.figures?.cashKobo ?? 0) > 0);
  const series = anyCash ? SERIES : SERIES.slice(0, 1);
  const selectedIndex = history.findIndex((h) => h.month === report.month);

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", pending && "opacity-60")}>
      <PageHeader
        title="Reports"
        description={
          isCurrent
            ? `${monthLabel(report.month)} so far, day by day`
            : `${monthLabel(report.month)}, day by day`
        }
        action={
          <MonthPicker
            months={history.map((h) => h.month)}
            value={report.month}
            current={currentMonth}
            onChange={(m) => go(m, currentMonth)}
          />
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Revenue"
          value={formatNaira(revenue)}
          icon={DollarSign}
          description={against(revenue, prevRevenue, formatNaira)}
        />
        <StatCard
          title="Vouchers Sold"
          value={totals.vouchersSold.toLocaleString()}
          icon={Ticket}
          description={against(totals.vouchersSold, comparison?.totals.vouchersSold ?? null, String)}
        />
        <StatCard
          title="Daily Average"
          value={formatNaira(Math.round(average))}
          icon={TrendingUp}
          description={`Over ${known.length} day${known.length === 1 ? "" : "s"}, ${daysWithSales} with sales`}
        />
        <StatCard
          title="Best Day"
          value={best && dayTotal(best) > 0 ? formatNaira(dayTotal(best)) : "-"}
          icon={CalendarCheck}
          description={best && dayTotal(best) > 0 ? weekdayDate(best.dateKey) : "No sales yet"}
        />
      </div>

      {/* Stretched, unlike the dashboard's rows: the mix card sits beside
          the chart as its companion, and a short card next to a tall one
          reads as something missing. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TrendCard
          className="lg:col-span-2"
          title="Day by day"
          description={anyCash ? "Revenue each day, online and cash" : "Revenue each day"}
          empty={
            revenue === 0
              ? {
                  icon: <ChartColumn />,
                  title: `No sales in ${monthName(report.month)}`,
                  description: "Each day's revenue appears here as customers buy vouchers.",
                }
              : null
          }
          legend={series.length > 1 ? <ChartLegend shape="block" series={series} /> : null}
          chart={
            <ColumnChart
              series={series}
              points={days.map((d) => ({
                key: d.dateKey,
                label: weekdayDate(d.dateKey),
                tick: d.partial ? "Today" : shortDate(d.dateKey),
                values: d.figures ? { onlineKobo: d.figures.onlineKobo, cashKobo: d.figures.cashKobo } : null,
                note: d.partial ? "So far today" : undefined,
              }))}
              format={formatNaira}
              axisFormat={formatNairaCompact}
              ariaLabel={`Revenue each day of ${monthLabel(report.month)}. The table below lists every day.`}
            />
          }
        />

        <ReportCard fill title="Where it came from" description="Online payments and printed codes sold for cash">
          <div className="flex flex-col gap-4">
            <MixBar
              format={formatNaira}
              parts={[
                { key: "online", label: "Online", color: "var(--series-1)", value: totals.onlineKobo },
                { key: "cash", label: "Cash", color: "var(--series-2)", value: totals.cashKobo },
              ]}
            />
            <FactList
              facts={[
                {
                  label: "Average voucher",
                  value: totals.vouchersSold ? formatNaira(Math.round(revenue / totals.vouchersSold)) : "-",
                },
                { label: "Days with sales", value: `${daysWithSales} of ${known.length}` },
              ]}
            />
          </div>
        </ReportCard>
      </div>

      <TrendCard
        title="Last 12 months"
        description="Revenue by month. Choose a month to open it."
        legend={series.length > 1 ? <ChartLegend shape="block" series={series} /> : null}
        chart={
          <ColumnChart
            series={series}
            selected={selectedIndex}
            minTickGap={28}
            onSelect={(i) => go(history[i].month, currentMonth)}
            points={history.map((h) => ({
              key: h.month,
              label: monthLabel(h.month),
              tick: monthName(h.month).slice(0, 3),
              values: h.totals ? { onlineKobo: h.totals.onlineKobo, cashKobo: h.totals.cashKobo } : null,
              note: h.month === currentMonth ? "So far" : undefined,
            }))}
            format={formatNaira}
            axisFormat={formatNairaCompact}
            ariaLabel="Revenue for each of the last 12 months. Press Enter on a month to open it."
          />
        }
      />

      <ReportCard title="Every day" description={monthLabel(report.month)} inset={false}>
        <div className="px-3 pb-2">
          <DayTable
            columns={anyCash ? ["Day", "Online", "Cash", "Revenue", "Vouchers"] : ["Day", "Revenue", "Vouchers"]}
            rows={[...days].reverse().map((d) => {
              const f = d.figures;
              const name = d.partial ? `${weekdayDate(d.dateKey)}, so far` : weekdayDate(d.dateKey);
              const blank = anyCash ? ["-", "-", "-", "-"] : ["-", "-"];
              if (!f) return { key: d.dateKey, cells: [name, ...blank], muted: true };
              const sum = f.onlineKobo + f.cashKobo;
              return {
                key: d.dateKey,
                muted: sum === 0,
                cells: anyCash
                  ? [name, formatNaira(f.onlineKobo), formatNaira(f.cashKobo), formatNaira(sum), String(f.vouchersSold)]
                  : [name, formatNaira(sum), String(f.vouchersSold)],
              };
            })}
            footer={
              anyCash
                ? ["Total", formatNaira(totals.onlineKobo), formatNaira(totals.cashKobo), formatNaira(revenue), String(totals.vouchersSold)]
                : ["Total", formatNaira(revenue), String(totals.vouchersSold)]
            }
          />
        </div>
      </ReportCard>
    </div>
  );
}
