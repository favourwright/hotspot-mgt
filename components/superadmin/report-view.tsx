"use client";

import { Building2, ChartColumn, DollarSign, ShoppingBag, Ticket } from "lucide-react";

import { cn, formatNaira, formatNairaCompact } from "@/lib/utils";
import {
  describeChange,
  monthName,
  shortDate,
  weekdayDate,
  type MonthKey,
} from "@/lib/stats-period";
import type { PlatformReport } from "@/lib/reports";
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

/**
 * The four income sources, in the fixed order their colours were checked
 * in (globals.css, `--series-*`). Commission first: it is the one that
 * moves with tenants' sales.
 */
const SOURCES = [
  { key: "commissionKobo", label: "Commission", color: "var(--series-1)", ink: "light" },
  { key: "planKobo", label: "Plans", color: "var(--series-2)", ink: "light" },
  { key: "addonKobo", label: "Addons", color: "var(--series-3)", ink: "dark" },
  { key: "creditsKobo", label: "Credits", color: "var(--series-4)", ink: "dark" },
] as const;

const INCOME_SERIES: ChartSeries[] = SOURCES.map(({ key, label, color }) => ({ key, label, color }));

type Income = Record<(typeof SOURCES)[number]["key"], number>;
const incomeOf = (d: Income) => SOURCES.reduce((s, src) => s + d[src.key], 0);
const pick = (d: Income) => Object.fromEntries(SOURCES.map((s) => [s.key, d[s.key]]));

/**
 * The platform's month in full: income by source, what tenants sold, and
 * who joined, day by day, with the twelve months around it.
 *
 * Tenant sales stop at the last morning the nightly job ran: they are every
 * tenant's sales added up, and that addition happens only there
 * (lib/reports.ts). The page says so wherever it shows them.
 */
export function PlatformReportView({
  report,
  currentMonth,
}: {
  report: PlatformReport;
  currentMonth: MonthKey;
}) {
  const { go, pending } = useReportMonth();
  const { totals, comparison, days, history, isCurrent, salesThroughKey } = report;
  const income = incomeOf(totals);

  const against = (now: number, before: number | null, throughKey: string | null, format: (v: number) => string) => {
    if (before === null || !comparison) return "No earlier month to compare";
    if (throughKey) return describeChange(now, before, throughKey, format);
    return describeChange(now, before, `${comparison.month}-01`, format).replace(
      / by .*$/,
      ` in ${monthName(comparison.month)}`
    );
  };

  const salesNote =
    isCurrent && salesThroughKey
      ? `To ${shortDate(salesThroughKey)}. ${against(totals.salesKobo, comparison?.salesKobo ?? null, comparison?.salesThroughKey ?? null, formatNaira)}`
      : against(totals.salesKobo, comparison?.salesKobo ?? null, comparison?.salesThroughKey ?? null, formatNaira);

  // Only the sources that earned anything this month get a colour in the
  // chart; the mix below still lists all four.
  const activeSeries = INCOME_SERIES.filter((s) =>
    days.some((d) => (d.figures?.[s.key as keyof Income] ?? 0) > 0)
  );
  const chartSeries = activeSeries.length ? activeSeries : INCOME_SERIES.slice(0, 1);
  const selectedIndex = history.findIndex((h) => h.month === report.month);
  const anySales = days.some((d) => (d.figures?.salesKobo ?? 0) > 0);

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", pending && "opacity-60")}>
      <PageHeader
        title="Reports"
        description={
          isCurrent
            ? `${monthLabel(report.month)} so far, across every tenant`
            : `${monthLabel(report.month)}, across every tenant`
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
          title="Income"
          value={formatNaira(income)}
          icon={DollarSign}
          description={against(income, comparison?.income ?? null, comparison?.incomeThroughKey ?? null, formatNaira)}
        />
        <StatCard title="Tenant Sales" value={formatNaira(totals.salesKobo)} icon={ShoppingBag} description={salesNote} />
        <StatCard
          title="Vouchers Sold"
          value={totals.vouchersSold.toLocaleString()}
          icon={Ticket}
          description={isCurrent && salesThroughKey ? `To ${shortDate(salesThroughKey)}` : "Across every tenant"}
        />
        <StatCard
          title="New Tenants"
          value={totals.newTenants}
          icon={Building2}
          description={isCurrent ? "Signed up this month" : `Signed up in ${monthName(report.month)}`}
        />
      </div>

      {/* Stretched, unlike the dashboard's rows: the mix card sits beside
          the chart as its companion, and a short card next to a tall one
          reads as something missing. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <TrendCard
          className="lg:col-span-2"
          title="Income by day"
          description="What tenants paid the platform each day, by source"
          empty={
            income === 0
              ? {
                  icon: <ChartColumn />,
                  title: `No income in ${monthName(report.month)}`,
                  description: "Commission, plan fees, addons and credits appear here as they are paid.",
                }
              : null
          }
          legend={chartSeries.length > 1 ? <ChartLegend shape="block" series={chartSeries} /> : null}
          chart={
            <ColumnChart
              series={chartSeries}
              points={days.map((d) => ({
                key: d.dateKey,
                label: weekdayDate(d.dateKey),
                tick: d.partial ? "Today" : shortDate(d.dateKey),
                values: d.figures ? pick(d.figures) : null,
                note: d.partial ? "So far today" : undefined,
              }))}
              format={formatNaira}
              axisFormat={formatNairaCompact}
              ariaLabel={`Platform income each day of ${monthLabel(report.month)}, by source. The table below lists every day.`}
            />
          }
        />

        <ReportCard fill title="Income mix" description="Where this month's income came from">
          <div className="flex flex-col gap-4">
            <MixBar
              format={formatNaira}
              parts={SOURCES.map((s) => ({ key: s.key, label: s.label, color: s.color, ink: s.ink, value: totals[s.key] }))}
            />
            <FactList
              facts={[
                {
                  label: "Commission rate",
                  // What the platform kept of what tenants sold online and
                  // in cash together, so it reads low wherever cash is big.
                  value: totals.salesKobo ? `${((totals.commissionKobo / totals.salesKobo) * 100).toFixed(1)}% of sales` : "-",
                },
                { label: "New tenants", value: String(totals.newTenants) },
              ]}
            />
          </div>
        </ReportCard>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <TrendCard
          title="Tenant sales by day"
          description={isCurrent ? "Every tenant's sales added up, to yesterday" : "Every tenant's sales added up"}
          empty={
            !anySales
              ? {
                  icon: <ChartColumn />,
                  title: `No tenant sales in ${monthName(report.month)}`,
                  description: "Each day's sales appear here the morning after.",
                }
              : null
          }
          chart={
            <ColumnChart
              series={[{ key: "salesKobo", label: "Sales", color: "var(--series-1)" }]}
              // Today has no sales figure yet, so the chart ends at the last
              // day that does rather than on an empty "Today".
              points={days
                .filter((d) => !d.partial)
                .map((d) => ({
                  key: d.dateKey,
                  label: weekdayDate(d.dateKey),
                  tick: shortDate(d.dateKey),
                  values: d.figures && d.figures.salesKobo !== null ? { salesKobo: d.figures.salesKobo } : null,
                }))}
              format={formatNaira}
              axisFormat={formatNairaCompact}
              ariaLabel={`Tenants' combined sales each day of ${monthLabel(report.month)}. The table below lists every day.`}
            />
          }
        />

        <TrendCard
          title="Last 12 months"
          description="Income by month and source. Choose a month to open it."
          legend={<ChartLegend shape="block" series={INCOME_SERIES} />}
          chart={
            <ColumnChart
              series={INCOME_SERIES}
              selected={selectedIndex}
              minTickGap={28}
              onSelect={(i) => go(history[i].month, currentMonth)}
              points={history.map((h) => ({
                key: h.month,
                label: monthLabel(h.month),
                tick: monthName(h.month).slice(0, 3),
                values: h.totals ? pick(h.totals) : null,
                note: h.month === currentMonth ? "So far" : undefined,
              }))}
              format={formatNaira}
              axisFormat={formatNairaCompact}
              ariaLabel="Platform income for each of the last 12 months, by source. Press Enter on a month to open it."
            />
          }
        />
      </div>

      <ReportCard title="Every day" description={monthLabel(report.month)} inset={false}>
        <div className="px-3 pb-2">
          <DayTable
            columns={["Day", ...SOURCES.map((s) => s.label), "Income", "Tenant sales", "Vouchers", "New tenants"]}
            rows={[...days].reverse().map((d) => {
              const f = d.figures;
              const name = d.partial ? `${weekdayDate(d.dateKey)}, so far` : weekdayDate(d.dateKey);
              if (!f) return { key: d.dateKey, cells: [name, "-", "-", "-", "-", "-", "-", "-", "-"], muted: true };
              return {
                key: d.dateKey,
                muted: incomeOf(f) === 0 && !f.salesKobo,
                cells: [
                  name,
                  ...SOURCES.map((s) => formatNaira(f[s.key])),
                  formatNaira(incomeOf(f)),
                  f.salesKobo === null ? "Tomorrow" : formatNaira(f.salesKobo),
                  f.vouchersSold === null ? "-" : String(f.vouchersSold),
                  String(f.newTenants),
                ],
              };
            })}
            footer={[
              "Total",
              ...SOURCES.map((s) => formatNaira(totals[s.key])),
              formatNaira(income),
              formatNaira(totals.salesKobo),
              String(totals.vouchersSold),
              String(totals.newTenants),
            ]}
          />
        </div>
      </ReportCard>
    </div>
  );
}
