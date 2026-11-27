/**
 * The report pages: a month in full, day by day, and the twelve months
 * around it. /{tenant}/admin/reports and /superadmin/reports.
 *
 * The dashboards' trend charts are a glance; this is where their figures
 * are read. It is built from the same stored days (lib/stats-rollup.ts),
 * one document per month, so a report costs 12 reads for the year plus, for
 * the current month, the same live tail the dashboard counts
 * (lib/dashboard-stats.ts). Cached per month and cleared with the
 * dashboard's figures on every sale (lib/stats-cache.ts).
 */
import { displayZoneDateKey, startOfDisplayZoneDate } from "@/lib/utils";
import {
  addFigures,
  dateKeyFor,
  dayKey,
  dayOfMonth,
  daysInMonth,
  monthKeyOf,
  previousMonthKey,
  samePointLastMonth,
  splitMonthToDate,
  type MonthDays,
  type MonthKey,
} from "@/lib/stats-period";
import {
  PLATFORM_INCOME_FIELDS,
  TENANT_FLOW_FIELDS,
  newTenantsBetween,
  platformIncomeBetween,
  readPlatformMonth,
  readTenantMonth,
  tenantFlowBetween,
  type PlatformDay,
  type PlatformIncome,
  type TenantFlow,
} from "@/lib/stats-rollup";
import { withYesterday, type DailyPoint } from "@/lib/dashboard-stats";

/** How far back a report reaches: the month picker offers these. */
export const REPORT_MONTHS = 12;

/** The twelve months ending with the current one, oldest first. */
function reportMonths(current: MonthKey): MonthKey[] {
  const out = [current];
  while (out.length < REPORT_MONTHS) out.unshift(previousMonthKey(out[0]));
  return out;
}

/** The month asked for, if a report can show it; otherwise this month. */
export function resolveReportMonth(requested: string | undefined, now: Date = new Date()): MonthKey {
  const current = monthKeyOf(displayZoneDateKey(now));
  return requested && reportMonths(current).includes(requested) ? requested : current;
}

function hasDays(days: MonthDays<unknown>): boolean {
  return Object.keys(days).length > 0;
}

/* ------------------------------------------------------------------ tenant */

export interface MonthTotal<T> {
  month: MonthKey;
  /** Null for a month with nothing stored: no data, which is not zero. */
  totals: T | null;
}

export interface TenantReport {
  month: MonthKey;
  isCurrent: boolean;
  /** Every day of the month; for the current month, up to today. */
  days: Array<DailyPoint<TenantFlow>>;
  totals: TenantFlow;
  /**
   * The month before: to the same day when this is the current month
   * (`throughKey` says which), whole otherwise. Null when it is not stored.
   */
  comparison: { month: MonthKey; totals: TenantFlow; throughKey: string | null } | null;
  /** The twelve months, oldest first. */
  history: Array<MonthTotal<TenantFlow>>;
}

export async function getTenantReport(
  tenantId: string,
  month: MonthKey,
  now: Date = new Date()
): Promise<TenantReport> {
  const todayKey = displayZoneDateKey(now);
  const current = monthKeyOf(todayKey);
  const months = reportMonths(current);
  const docs = await Promise.all(months.map((m) => readTenantMonth(tenantId, m)));

  // The current month is stored days plus a live tail, exactly as on the
  // dashboard, so the report's "this month" is the dashboard's to the kobo.
  const currentDocIndex = months.length - 1;
  const { stored, liveFromKey } = splitMonthToDate(TENANT_FLOW_FIELDS, docs[currentDocIndex], todayKey);
  const [live, todayOnly] = await Promise.all([
    tenantFlowBetween(tenantId, startOfDisplayZoneDate(liveFromKey)!, null),
    liveFromKey === todayKey ? null : tenantFlowBetween(tenantId, startOfDisplayZoneDate(todayKey)!, null),
  ]);
  const today = todayOnly ?? live;
  const currentTotals = addFigures(TENANT_FLOW_FIELDS, stored, live);
  docs[currentDocIndex] = withYesterday(
    TENANT_FLOW_FIELDS,
    docs[currentDocIndex],
    todayKey,
    liveFromKey,
    live,
    todayOnly
  );

  const totalsOf = (i: number): TenantFlow | null => {
    if (i === currentDocIndex) return currentTotals;
    return hasDays(docs[i])
      ? addFigures(TENANT_FLOW_FIELDS, ...Object.values(docs[i]))
      : null;
  };

  const index = months.indexOf(month);
  const isCurrent = month === current;
  const dayCount = isCurrent ? dayOfMonth(todayKey) : daysInMonth(month);
  const days = Array.from({ length: dayCount }, (_, d) => {
    const dateKey = dateKeyFor(month, d + 1);
    if (dateKey === todayKey) return { dateKey, figures: today, partial: true };
    const stored = docs[index][dayKey(d + 1)];
    return {
      dateKey,
      figures: stored
        ? { onlineKobo: stored.onlineKobo, cashKobo: stored.cashKobo, vouchersSold: stored.vouchersSold }
        : null,
      partial: false,
    };
  });

  let comparison: TenantReport["comparison"] = null;
  if (index > 0) {
    const prev = docs[index - 1];
    if (isCurrent) {
      const same = samePointLastMonth(TENANT_FLOW_FIELDS, prev, todayKey);
      if (same) comparison = { month: months[index - 1], totals: same.figures, throughKey: same.throughKey };
    } else {
      const totals = totalsOf(index - 1);
      if (totals) comparison = { month: months[index - 1], totals, throughKey: null };
    }
  }

  return {
    month,
    isCurrent,
    days,
    totals: totalsOf(index) ?? addFigures(TENANT_FLOW_FIELDS),
    comparison,
    history: months.map((m, i) => ({ month: m, totals: totalsOf(i) })),
  };
}

/* ---------------------------------------------------------------- platform */

/**
 * A platform day as the report shows it. Sales are null where they are not
 * stored yet - today, always, and yesterday until the morning job - because
 * the platform's sales are the sum of every tenant's and are only ever
 * added up by that job. Income and new tenants are known to the minute.
 */
export type PlatformReportDay = PlatformIncome & {
  newTenants: number;
  salesKobo: number | null;
  vouchersSold: number | null;
};

export interface PlatformReport {
  month: MonthKey;
  isCurrent: boolean;
  days: Array<DailyPoint<PlatformReportDay>>;
  totals: PlatformIncome & { newTenants: number; salesKobo: number; vouchersSold: number };
  /** The last day the sales totals cover, for the current month. */
  salesThroughKey: string | null;
  comparison: {
    month: MonthKey;
    income: number;
    /** To the same day as this month's income, or the whole month. */
    incomeThroughKey: string | null;
    /** Sales to the same day as this month's sales (yesterday), or whole. */
    salesKobo: number | null;
    salesThroughKey: string | null;
  } | null;
  history: Array<MonthTotal<PlatformIncome & { salesKobo: number }>>;
}

const income = (d: Partial<PlatformIncome>) =>
  PLATFORM_INCOME_FIELDS.reduce((sum, f) => sum + (Number(d[f]) || 0), 0);

export async function getPlatformReport(
  month: MonthKey,
  now: Date = new Date()
): Promise<PlatformReport> {
  const todayKey = displayZoneDateKey(now);
  const current = monthKeyOf(todayKey);
  const months = reportMonths(current);
  const docs = await Promise.all(months.map((m) => readPlatformMonth(m)));
  const currentDocIndex = months.length - 1;
  const todayStart = startOfDisplayZoneDate(todayKey)!;

  const { stored, liveFromKey } = splitMonthToDate(PLATFORM_INCOME_FIELDS, docs[currentDocIndex], todayKey);
  const [live, todayOnly, newThisMonth, newToday] = await Promise.all([
    platformIncomeBetween(startOfDisplayZoneDate(liveFromKey)!, null),
    liveFromKey === todayKey ? null : platformIncomeBetween(todayStart, null),
    newTenantsBetween(startOfDisplayZoneDate(dateKeyFor(current, 1))!, null),
    newTenantsBetween(todayStart, null),
  ]);
  const todayIncome = todayOnly ?? live;
  const currentIncome = addFigures(PLATFORM_INCOME_FIELDS, stored, live);
  // Income for yesterday, if the job has not stored it: the live tail less
  // today. Its sales stay unknown.
  const recovered = withYesterday(
    PLATFORM_INCOME_FIELDS,
    docs[currentDocIndex] as MonthDays<PlatformIncome>,
    todayKey,
    liveFromKey,
    live,
    todayOnly
  );

  const salesOf = (days: MonthDays<PlatformDay>) =>
    Object.values(days).reduce(
      (acc, d) => ({
        salesKobo: acc.salesKobo + (Number(d?.salesKobo) || 0),
        vouchersSold: acc.vouchersSold + (Number(d?.vouchersSold) || 0),
        newTenants: acc.newTenants + (Number(d?.newTenants) || 0),
      }),
      { salesKobo: 0, vouchersSold: 0, newTenants: 0 }
    );

  const totalsOf = (i: number): PlatformReport["totals"] | null => {
    if (i === currentDocIndex) {
      const sales = salesOf(docs[i]);
      return { ...currentIncome, ...sales, newTenants: newThisMonth };
    }
    if (!hasDays(docs[i])) return null;
    return { ...addFigures(PLATFORM_INCOME_FIELDS, ...Object.values(docs[i])), ...salesOf(docs[i]) };
  };

  const index = months.indexOf(month);
  const isCurrent = month === current;
  const dayCount = isCurrent ? dayOfMonth(todayKey) : daysInMonth(month);
  const days = Array.from({ length: dayCount }, (_, d): DailyPoint<PlatformReportDay> => {
    const dateKey = dateKeyFor(month, d + 1);
    if (dateKey === todayKey) {
      return {
        dateKey,
        figures: { ...todayIncome, newTenants: newToday, salesKobo: null, vouchersSold: null },
        partial: true,
      };
    }
    const stored = docs[index][dayKey(d + 1)];
    const incomeDay = isCurrent ? recovered[dayKey(d + 1)] : stored;
    if (!stored && !incomeDay) return { dateKey, figures: null, partial: false };
    return {
      dateKey,
      figures: {
        ...addFigures(PLATFORM_INCOME_FIELDS, incomeDay ?? stored),
        newTenants: Number(stored?.newTenants) || 0,
        salesKobo: stored ? Number(stored.salesKobo) || 0 : null,
        vouchersSold: stored ? Number(stored.vouchersSold) || 0 : null,
      },
      partial: false,
    };
  });

  // Sales run to the last stored day, which is yesterday at best.
  const lastStoredSalesDay = isCurrent
    ? [...days].reverse().find((d) => d.figures?.salesKobo !== null && d.figures !== null)?.dateKey ?? null
    : null;

  let comparison: PlatformReport["comparison"] = null;
  if (index > 0) {
    const prev = docs[index - 1];
    if (isCurrent) {
      const sameIncome = samePointLastMonth(PLATFORM_INCOME_FIELDS, prev, todayKey);
      const sameSales =
        lastStoredSalesDay && monthKeyOf(lastStoredSalesDay) === current
          ? samePointLastMonth(["salesKobo"] as const, prev, lastStoredSalesDay)
          : null;
      if (sameIncome || sameSales) {
        comparison = {
          month: months[index - 1],
          income: sameIncome ? income(sameIncome.figures) : 0,
          incomeThroughKey: sameIncome?.throughKey ?? null,
          salesKobo: sameSales?.figures.salesKobo ?? null,
          salesThroughKey: sameSales?.throughKey ?? null,
        };
      }
    } else {
      const totals = totalsOf(index - 1);
      if (totals) {
        comparison = {
          month: months[index - 1],
          income: income(totals),
          incomeThroughKey: null,
          salesKobo: totals.salesKobo,
          salesThroughKey: null,
        };
      }
    }
  }

  return {
    month,
    isCurrent,
    days,
    totals: totalsOf(index) ?? { ...addFigures(PLATFORM_INCOME_FIELDS), salesKobo: 0, vouchersSold: 0, newTenants: 0 },
    salesThroughKey: lastStoredSalesDay,
    comparison,
    history: months.map((m, i) => {
      const t = totalsOf(i);
      return { month: m, totals: t ? { ...addFigures(PLATFORM_INCOME_FIELDS, t), salesKobo: t.salesKobo } : null };
    }),
  };
}
