/**
 * The figures on the two overview pages: the tenant's /admin and the
 * superadmin's /superadmin.
 *
 * Money and sales are "this month so far", in Lagos, with the same point
 * last month beside them; all-time totals belong to the pages these cards
 * link to, which filter by date. State (active vouchers, failed, tenants by
 * status, MRR) is live, because "now" is the only useful answer for it.
 *
 * A month is read as its stored days (lib/stats-rollup.ts) plus a live
 * aggregation from the first day the store does not have, so the figure is
 * exact whether or not the nightly job has run (lib/stats-period.ts).
 *
 * Reads, per uncached call: tenant 2 month documents + 3 live aggregations
 * (6 before the nightly job has caught up) + 5 counts; platform 2 month
 * documents + 4 live sums (8 before the job) + 7 counts and sums. Cached per tenant
 * and invalidated on each sale (lib/stats-cache.ts).
 */
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { AggregateField } from "firebase-admin/firestore";
import { displayZoneDateKey, startOfDisplayZoneDate } from "@/lib/utils";
import {
  addDays,
  addFigures,
  dateKeyFor,
  dayKey,
  dayOfMonth,
  daysInMonth,
  monthKeyOf,
  previousMonthKey,
  runningTotals,
  samePointLastMonth,
  splitMonthToDate,
  storedDay,
  windowKeys,
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
  tenantSnapshot,
  type PlatformDay,
  type PlatformIncome,
  type TenantDay,
  type TenantFlow,
} from "@/lib/stats-rollup";

/* ------------------------------------------------------------------ trends */

/** How many days the daily chart shows. */
export const TREND_DAYS = 30;

export interface DailyPoint<T> {
  dateKey: string;
  /** Null for a day not tallied yet: drawn as a gap, never as zero. */
  figures: T | null;
  /** Today, which is still going. */
  partial: boolean;
}

/** A month's running total, day by day, beside last month's. */
export interface PaceSeries {
  thisMonthKey: MonthKey;
  lastMonthKey: MonthKey;
  /** Index 0 is the 1st. Ends at today. Null where a day is unknown. */
  thisMonth: Array<number | null>;
  /** Every day of last month. Null where a day is unknown. */
  lastMonth: Array<number | null>;
}

/**
 * This month's running total and last month's, from the two month
 * documents already read for the cards: no extra queries.
 */
function paceSeries<T>(
  todayKey: string,
  thisMonth: MonthDays<T>,
  lastMonth: MonthDays<T>,
  value: (day: T) => number,
  todayValue: number,
  monthTotal: number
): PaceSeries {
  const month = monthKeyOf(todayKey);
  const last = previousMonthKey(month);
  const today = dayOfMonth(todayKey);
  const thisValues = Array.from({ length: today }, (_, i) => {
    if (i + 1 === today) return todayValue;
    const day = thisMonth[dayKey(i + 1)];
    return day ? value(day) : null;
  });
  const lastValues = Array.from({ length: daysInMonth(last) }, (_, i) => {
    const day = lastMonth[dayKey(i + 1)];
    return day ? value(day) : null;
  });
  return {
    thisMonthKey: month,
    lastMonthKey: last,
    // Pinned to the card's figure, so the line ends where the number says.
    thisMonth: runningTotals(thisValues, monthTotal),
    lastMonth: runningTotals(lastValues),
  };
}

/**
 * The day before today, recovered from the live tail when it is the only
 * day the store lacks: the tail is yesterday plus today, and today is known
 * on its own. That is the usual state between midnight and the 07:00 job,
 * and it costs no read. A longer gap stays a gap.
 */
export function withYesterday<F extends string>(
  fields: readonly F[],
  days: MonthDays<Record<F, number>>,
  todayKey: string,
  liveFromKey: string,
  live: Record<F, number>,
  today: Record<F, number> | null
): MonthDays<Record<F, number>> {
  const yesterday = addDays(todayKey, -1);
  if (!today || liveFromKey !== yesterday || monthKeyOf(yesterday) !== monthKeyOf(todayKey)) {
    return days;
  }
  const figures = Object.fromEntries(fields.map((f) => [f, live[f] - today[f]])) as Record<F, number>;
  return { ...days, [dayKey(dayOfMonth(yesterday))]: figures };
}

export interface Comparison<T> {
  figures: T;
  /** The last date the comparison covers, `YYYY-MM-DD`: "by 27 Oct". */
  throughKey: string;
}

export interface TenantDashboardStats {
  /** The 1st of this month, `YYYY-MM-DD`: what the cards link to as `from`. */
  monthStartKey: string;
  month: TenantFlow;
  today: TenantFlow;
  /** Null until last month's days are all stored. */
  lastMonth: Comparison<TenantFlow> | null;
  activeVouchers: number;
  failedVouchers: number;
  trend: {
    /** The last 30 days, ending today. */
    daily: Array<DailyPoint<{ onlineKobo: number; cashKobo: number }>>;
    /** Revenue, online and cash together. */
    pace: PaceSeries;
  };
  /** Setup progress - drives the dashboard's next-step action. */
  routerCount: number;
  locationCount: number;
  planCount: number;
}

export async function getTenantStats(
  tenantId: string,
  now: Date = new Date()
): Promise<TenantDashboardStats> {
  const todayKey = displayZoneDateKey(now);
  const month = monthKeyOf(todayKey);

  const [thisMonth, lastMonthDays, snapshot, routers, locations, plans] = await Promise.all([
    readTenantMonth(tenantId, month),
    readTenantMonth(tenantId, previousMonthKey(month)),
    tenantSnapshot(tenantId),
    // Unfiltered `count()` needs no composite index and bills one read.
    adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).count().get(),
    adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).count().get(),
    adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).count().get(),
  ]);

  const { stored, liveFromKey } = splitMonthToDate(TENANT_FLOW_FIELDS, thisMonth, todayKey);
  const [live, todayOnly] = await Promise.all([
    tenantFlowBetween(tenantId, startOfDisplayZoneDate(liveFromKey)!, null),
    // In steady state the live window *is* today, and one query answers both.
    liveFromKey === todayKey
      ? null
      : tenantFlowBetween(tenantId, startOfDisplayZoneDate(todayKey)!, null),
  ]);

  const monthFigures = addFigures(TENANT_FLOW_FIELDS, stored, live);
  const todayFigures = todayOnly ?? live;
  const filled = withYesterday(TENANT_FLOW_FIELDS, thisMonth, todayKey, liveFromKey, live, todayOnly);
  const months: Record<MonthKey, MonthDays<TenantDay>> = {
    [month]: filled,
    [previousMonthKey(month)]: lastMonthDays,
  };
  const revenue = (d: TenantFlow) => d.onlineKobo + d.cashKobo;

  return {
    monthStartKey: dateKeyFor(month, 1),
    month: monthFigures,
    today: todayFigures,
    lastMonth: samePointLastMonth(TENANT_FLOW_FIELDS, lastMonthDays, todayKey),
    ...snapshot,
    trend: {
      daily: windowKeys(todayKey, TREND_DAYS).map((dateKey) => {
        const day = dateKey === todayKey ? todayFigures : storedDay(months, dateKey);
        return {
          dateKey,
          figures: day ? { onlineKobo: day.onlineKobo, cashKobo: day.cashKobo } : null,
          partial: dateKey === todayKey,
        };
      }),
      pace: paceSeries(todayKey, filled, lastMonthDays, revenue, revenue(todayFigures), revenue(monthFigures)),
    },
    routerCount: routers.data().count,
    locationCount: locations.data().count,
    planCount: plans.data().count,
  };
}

export interface PlatformOverviewStats {
  monthStartKey: string;
  /** What tenants paid the platform: sale commission, plans, addons, credits. */
  income: {
    month: PlatformIncome;
    today: PlatformIncome;
    lastMonth: Comparison<PlatformIncome> | null;
  };
  newTenantsThisMonth: number;
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  pendingTenants: number;
  /** What active tenants' plans say they pay each month, not money collected. */
  mrr: number;
  activeVouchers: number;
  trend: {
    /**
     * What tenants sold, online and cash, over the 30 days ending yesterday.
     * Not today: the platform's sales are the sum of every tenant's, stored
     * by the nightly job, and adding them up live would be a query per
     * tenant on every load.
     */
    daily: Array<DailyPoint<{ salesKobo: number }>>;
    /** Income from every source together. */
    pace: PaceSeries;
  };
}

export async function getPlatformOverview(
  now: Date = new Date()
): Promise<PlatformOverviewStats> {
  const todayKey = displayZoneDateKey(now);
  const month = monthKeyOf(todayKey);
  const monthStart = startOfDisplayZoneDate(dateKeyFor(month, 1))!;
  const tenants = adminDb.collection(COLLECTIONS.TENANTS);

  const [thisMonth, lastMonthDays, newTenants, total, active, mrr, suspended, pending, vouchers] =
    await Promise.all([
      readPlatformMonth(month),
      readPlatformMonth(previousMonthKey(month)),
      newTenantsBetween(monthStart, null),
      tenants.count().get(),
      // MRR's sum and the count are separate queries on purpose: beside a
      // `sum()`, a count only sees documents that have the summed field
      // (lib/stats-rollup.ts, `tenantFlowBetween`).
      tenants.where("status", "==", "active").count().get(),
      tenants
        .where("status", "==", "active")
        .aggregate({ mrr: AggregateField.sum("monthlyFee") })
        .get(),
      tenants.where("status", "==", "suspended").count().get(),
      tenants.where("status", "==", "pending").count().get(),
      adminDb.collectionGroup("vouchers").where("status", "==", "active").count().get(),
    ]);

  const { stored, liveFromKey } = splitMonthToDate(PLATFORM_INCOME_FIELDS, thisMonth, todayKey);
  const [live, todayOnly] = await Promise.all([
    platformIncomeBetween(startOfDisplayZoneDate(liveFromKey)!, null),
    liveFromKey === todayKey
      ? null
      : platformIncomeBetween(startOfDisplayZoneDate(todayKey)!, null),
  ]);

  const monthIncome = addFigures(PLATFORM_INCOME_FIELDS, stored, live);
  const todayIncome = todayOnly ?? live;
  const months: Record<MonthKey, MonthDays<PlatformDay>> = {
    [month]: thisMonth,
    [previousMonthKey(month)]: lastMonthDays,
  };
  const income = (d: PlatformIncome) =>
    PLATFORM_INCOME_FIELDS.reduce((sum, f) => sum + (Number(d[f]) || 0), 0);

  return {
    monthStartKey: dateKeyFor(month, 1),
    income: {
      month: monthIncome,
      today: todayIncome,
      lastMonth: samePointLastMonth(PLATFORM_INCOME_FIELDS, lastMonthDays, todayKey),
    },
    trend: {
      daily: windowKeys(addDays(todayKey, -1), TREND_DAYS).map((dateKey) => {
        const day = storedDay(months, dateKey);
        return {
          dateKey,
          figures: day ? { salesKobo: Number(day.salesKobo) || 0 } : null,
          partial: false,
        };
      }),
      // Yesterday's income, if the job has not stored it yet, is the live
      // tail less today; the same recovery as the tenant's, for one field.
      pace: paceSeries(
        todayKey,
        withYesterday(
          PLATFORM_INCOME_FIELDS,
          thisMonth as MonthDays<PlatformIncome>,
          todayKey,
          liveFromKey,
          live,
          todayOnly
        ),
        lastMonthDays as MonthDays<PlatformIncome>,
        income,
        income(todayIncome),
        income(monthIncome)
      ),
    },
    newTenantsThisMonth: newTenants,
    totalTenants: total.data().count,
    activeTenants: active.data().count,
    suspendedTenants: suspended.data().count,
    pendingTenants: pending.data().count,
    mrr: mrr.data().mrr ?? 0,
    activeVouchers: vouchers.data().count,
  };
}
