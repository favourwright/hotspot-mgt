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
  addFigures,
  dateKeyFor,
  monthKeyOf,
  previousMonthKey,
  samePointLastMonth,
  splitMonthToDate,
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
  type PlatformIncome,
  type TenantFlow,
} from "@/lib/stats-rollup";

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

  return {
    monthStartKey: dateKeyFor(month, 1),
    month: addFigures(TENANT_FLOW_FIELDS, stored, live),
    today: todayOnly ?? live,
    lastMonth: samePointLastMonth(TENANT_FLOW_FIELDS, lastMonthDays, todayKey),
    ...snapshot,
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

  return {
    monthStartKey: dateKeyFor(month, 1),
    income: {
      month: addFigures(PLATFORM_INCOME_FIELDS, stored, live),
      today: todayOnly ?? live,
      lastMonth: samePointLastMonth(PLATFORM_INCOME_FIELDS, lastMonthDays, todayKey),
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
