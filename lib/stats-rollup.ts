/**
 * Daily sales figures, stored one document per Lagos month.
 *
 * `tenants/{id}/statsMonthly/2026-11` and `platformStatsMonthly/2026-11`,
 * each holding `days: { "01": {...}, "02": {...} }`. The dashboards read a
 * month as one document instead of re-aggregating it on every load, and the
 * same document is a month of daily history for a chart, for free.
 *
 * Written by the sales-digest cron for the two days before today, never by
 * the sale itself: nothing on the payment path changes, no sale costs an
 * extra write, and no single document takes a write from every tenant at
 * once. The source of truth stays `payments`, `vouchers` and the revenue
 * ledger; a day here is a cached aggregation of them, and re-running a day
 * overwrites it with the same answer. `npm run stats:backfill` builds past
 * months the same way.
 *
 * The flow figures (money in, vouchers sold) can be recomputed for any past
 * day. The snapshot figures (active vouchers, MRR, tenant counts) cannot:
 * they are what was true when the job ran, about 07:00 Lagos the morning
 * after, and are only ever written for yesterday. A night the job misses is
 * a snapshot lost for good, and a gap the dashboards cover live.
 *
 * Cost, per night: 3 aggregations per tenant per day recomputed plus 2
 * snapshot counts, one write per tenant; the platform adds 5 per day and 4
 * snapshot figures. Every aggregation bills one read per 1000 entries.
 */
import { AggregateField, FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import type { RevenueSource } from "@/lib/platform-revenue";
import { displayZoneDateKey, endOfDisplayZoneDate, startOfDisplayZoneDate } from "@/lib/utils";
import { addDays, dayKey, dayOfMonth, monthKeyOf, type MonthDays, type MonthKey } from "@/lib/stats-period";

/* ------------------------------------------------------------------ shapes */

/** Money a tenant took and vouchers they sold, over some window. */
export const TENANT_FLOW_FIELDS = ["onlineKobo", "cashKobo", "vouchersSold"] as const;
export type TenantFlowField = (typeof TENANT_FLOW_FIELDS)[number];
export type TenantFlow = Record<TenantFlowField, number>;

/** End-of-day state, recorded the morning after. */
export interface TenantSnapshot {
  activeVouchers: number;
  failedVouchers: number;
}

export type TenantDay = TenantFlow & Partial<TenantSnapshot>;

/** What tenants paid the platform, by source, plus what they sold. */
export const PLATFORM_INCOME_FIELDS = [
  "commissionKobo",
  "planKobo",
  "addonKobo",
  "creditsKobo",
] as const;
export const PLATFORM_FLOW_FIELDS = [
  ...PLATFORM_INCOME_FIELDS,
  "salesKobo",
  "vouchersSold",
  "newTenants",
] as const;
export type PlatformIncomeField = (typeof PLATFORM_INCOME_FIELDS)[number];
export type PlatformFlowField = (typeof PLATFORM_FLOW_FIELDS)[number];
export type PlatformIncome = Record<PlatformIncomeField, number>;
export type PlatformFlow = Record<PlatformFlowField, number>;

export interface PlatformSnapshot {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  mrrKobo: number;
  activeVouchers: number;
}

export type PlatformDay = PlatformFlow & Partial<PlatformSnapshot>;

const INCOME_SOURCE: Record<PlatformIncomeField, RevenueSource> = {
  commissionKobo: "commission",
  planKobo: "plan",
  addonKobo: "addon",
  creditsKobo: "credits",
};

/* ----------------------------------------------------------------- queries */

/**
 * A tenant's sales from `start` up to `end` (exclusive), or up to now.
 *
 * The aggregations `getTenantStats` has always run for "today", with a
 * different lower bound and sometimes an upper one, so they ride the same
 * indexes: `payments (status, createdAt)` and `vouchers (createdAt,
 * cashSaleKobo)`, plus a plain count on `createdAt`. A generated voucher's `createdAt` is its first use, so a
 * printed card counts on the day it was sold, as everywhere else.
 */
export async function tenantFlowBetween(
  tenantId: string,
  start: Date,
  end: Date | null
): Promise<TenantFlow> {
  let payments = adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .where("status", "==", "success")
    .where("createdAt", ">=", start);
  let vouchers = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("createdAt", ">=", start);
  if (end) {
    payments = payments.where("createdAt", "<", end);
    vouchers = vouchers.where("createdAt", "<", end);
  }

  // The count is its own query, never beside the `sum("cashSaleKobo")`. In
  // one aggregation Firestore answers from the index on the summed field,
  // which holds only the documents that have it, so the count came back as
  // generated codes alone: 126 of a tenant's 278 vouchers, on the live
  // dashboard, for as long as the two shared a query.
  const [online, cash, sold] = await Promise.all([
    payments.aggregate({ total: AggregateField.sum("amount") }).get(),
    vouchers.aggregate({ cash: AggregateField.sum("cashSaleKobo") }).get(),
    vouchers.count().get(),
  ]);

  return {
    onlineKobo: online.data().total ?? 0,
    cashKobo: cash.data().cash ?? 0,
    vouchersSold: sold.data().count,
  };
}

/**
 * The revenue ledger from `start` up to `end` (exclusive), or up to now, by
 * source. One aggregation per source on the `(source, occurredAt,
 * amountKobo)` index that `getPlatformRevenue` already uses.
 */
export async function platformIncomeBetween(
  start: Date,
  end: Date | null
): Promise<PlatformIncome> {
  const ledger = adminDb.collection(COLLECTIONS.PLATFORM_REVENUE);
  const entries = await Promise.all(
    PLATFORM_INCOME_FIELDS.map(async (field) => {
      let q = ledger
        .where("source", "==", INCOME_SOURCE[field])
        .where("occurredAt", ">=", start);
      if (end) q = q.where("occurredAt", "<", end);
      const snap = await q.aggregate({ total: AggregateField.sum("amountKobo") }).get();
      return [field, snap.data().total ?? 0] as const;
    })
  );
  return Object.fromEntries(entries) as PlatformIncome;
}

/** Tenants created in the window. Single-field range, no composite index. */
export async function newTenantsBetween(start: Date, end: Date | null): Promise<number> {
  let q = adminDb.collection(COLLECTIONS.TENANTS).where("createdAt", ">=", start);
  if (end) q = q.where("createdAt", "<", end);
  return (await q.count().get()).data().count;
}

export async function tenantSnapshot(tenantId: string): Promise<TenantSnapshot> {
  const vouchers = adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId));
  const [active, failed] = await Promise.all([
    vouchers.where("status", "==", "active").count().get(),
    vouchers.where("status", "==", "failed").count().get(),
  ]);
  return { activeVouchers: active.data().count, failedVouchers: failed.data().count };
}

export async function platformSnapshot(): Promise<PlatformSnapshot> {
  const tenants = adminDb.collection(COLLECTIONS.TENANTS);
  const [total, active, mrr, suspended, vouchers] = await Promise.all([
    tenants.count().get(),
    // Separate, as in `tenantFlowBetween`: a count beside a sum sees only
    // the documents that have the summed field.
    tenants.where("status", "==", "active").count().get(),
    tenants.where("status", "==", "active").aggregate({ mrr: AggregateField.sum("monthlyFee") }).get(),
    tenants.where("status", "==", "suspended").count().get(),
    adminDb.collectionGroup("vouchers").where("status", "==", "active").count().get(),
  ]);
  return {
    totalTenants: total.data().count,
    activeTenants: active.data().count,
    suspendedTenants: suspended.data().count,
    mrrKobo: mrr.data().mrr ?? 0,
    activeVouchers: vouchers.data().count,
  };
}

/* ------------------------------------------------------- month documents */

function tenantMonthRef(tenantId: string, month: MonthKey) {
  return adminDb.collection(TENANT_COLLECTIONS.statsMonthly(tenantId)).doc(month);
}

function platformMonthRef(month: MonthKey) {
  return adminDb.collection(COLLECTIONS.PLATFORM_STATS_MONTHLY).doc(month);
}

async function readDays<T>(ref: FirebaseFirestore.DocumentReference): Promise<MonthDays<T>> {
  const snap = await ref.get();
  const days = snap.exists ? snap.get("days") : null;
  return days && typeof days === "object" ? (days as MonthDays<T>) : {};
}

/** One read. A month never rolled up reads as no days at all. */
export function readTenantMonth(tenantId: string, month: MonthKey) {
  return readDays<TenantDay>(tenantMonthRef(tenantId, month));
}

export function readPlatformMonth(month: MonthKey) {
  return readDays<PlatformDay>(platformMonthRef(month));
}

/**
 * Writes days into their month documents, one write per month touched.
 *
 * `merge` deep-merges the `days` map, so recomputing a day's flow figures
 * leaves the snapshot fields recorded beside them, and other days, alone.
 */
async function writeDays<T extends object>(
  refFor: (month: MonthKey) => FirebaseFirestore.DocumentReference,
  days: Array<{ dateKey: string; figures: T }>
): Promise<void> {
  const byMonth = new Map<MonthKey, Record<string, T>>();
  for (const { dateKey, figures } of days) {
    const month = monthKeyOf(dateKey);
    if (!byMonth.has(month)) byMonth.set(month, {});
    byMonth.get(month)![dayKey(dayOfMonth(dateKey))] = figures;
  }
  await Promise.all(
    [...byMonth].map(([month, map]) =>
      refFor(month).set({ days: map, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    )
  );
}

/** Lagos midnight to Lagos midnight for one calendar date. */
export function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = startOfDisplayZoneDate(dateKey);
  const last = endOfDisplayZoneDate(dateKey);
  if (!start || !last) throw new Error(`not a date: ${dateKey}`);
  return { start, end: new Date(last.getTime() + 1) };
}

/* ------------------------------------------------------------------ writers */

/** Stores computed days for a tenant. One write per month touched. */
export function writeTenantDays(
  tenantId: string,
  days: Array<{ dateKey: string; figures: TenantDay }>
): Promise<void> {
  return writeDays<TenantDay>((month) => tenantMonthRef(tenantId, month), days);
}

/** Stores computed days for the platform. One write per month touched. */
export function writePlatformDays(
  days: Array<{ dateKey: string; figures: PlatformDay }>
): Promise<void> {
  return writeDays<PlatformDay>(platformMonthRef, days);
}

/**
 * Recomputes a tenant's flow figures for each date and stores them. When
 * `snapshotFor` is one of the dates, today's state is recorded against it.
 */
export async function rollupTenantDays(
  tenantId: string,
  dateKeys: string[],
  snapshotFor: string | null
): Promise<TenantFlow[]> {
  const flows = await Promise.all(
    dateKeys.map((key) => {
      const { start, end } = dayBounds(key);
      return tenantFlowBetween(tenantId, start, end);
    })
  );
  const snapshot = snapshotFor && dateKeys.includes(snapshotFor) ? await tenantSnapshot(tenantId) : null;
  await writeTenantDays(
    tenantId,
    dateKeys.map((dateKey, i) => ({
      dateKey,
      figures: dateKey === snapshotFor && snapshot ? { ...flows[i], ...snapshot } : flows[i],
    }))
  );
  return flows;
}

/**
 * The platform's days. `sales` is every tenant's flow for the same dates,
 * summed by the caller from the tenant rollups it just did, so the platform
 * total never re-queries what the tenants' figures already hold.
 */
export async function rollupPlatformDays(
  dateKeys: string[],
  sales: Array<{ salesKobo: number; vouchersSold: number }>,
  snapshotFor: string | null
): Promise<void> {
  const figures = await Promise.all(
    dateKeys.map(async (key, i) => {
      const { start, end } = dayBounds(key);
      const [income, newTenants] = await Promise.all([
        platformIncomeBetween(start, end),
        newTenantsBetween(start, end),
      ]);
      return { ...income, ...sales[i], newTenants } satisfies PlatformFlow;
    })
  );
  const snapshot = snapshotFor && dateKeys.includes(snapshotFor) ? await platformSnapshot() : null;
  await writePlatformDays(
    dateKeys.map((dateKey, i) => ({
      dateKey,
      figures: dateKey === snapshotFor && snapshot ? { ...figures[i], ...snapshot } : figures[i],
    }))
  );
}

/**
 * The nightly pass, run from the sales-digest cron: yesterday and the day
 * before, for every tenant given and for the platform.
 *
 * Two days rather than one so a night the job misses is filled in the next
 * morning. Past that, the dashboards count the gap live (lib/stats-period.ts)
 * and the backfill script restores it.
 *
 * Partial failure is fine, as in every job: one tenant's error is named and
 * the rest carry on. The platform's sales total is then short by that
 * tenant, so its days are skipped too rather than written wrong.
 */
export async function runStatsRollup(
  tenantIds: string[],
  now: Date = new Date()
): Promise<{ tenants: number; errors: string[] }> {
  const yesterday = addDays(displayZoneDateKey(now), -1);
  const dateKeys = [addDays(yesterday, -1), yesterday];
  const errors: string[] = [];
  const sales = dateKeys.map(() => ({ salesKobo: 0, vouchersSold: 0 }));
  let tenants = 0;

  for (const tenantId of tenantIds) {
    try {
      const flows = await rollupTenantDays(tenantId, dateKeys, yesterday);
      flows.forEach((flow, i) => {
        sales[i].salesKobo += flow.onlineKobo + flow.cashKobo;
        sales[i].vouchersSold += flow.vouchersSold;
      });
      tenants += 1;
    } catch (error) {
      errors.push(`stats rollup, tenant ${tenantId}: ${String(error)}`);
    }
  }

  if (errors.length === 0) {
    try {
      await rollupPlatformDays(dateKeys, sales, yesterday);
    } catch (error) {
      errors.push(`stats rollup, platform: ${String(error)}`);
    }
  } else {
    errors.push("stats rollup, platform: skipped, a tenant failed and its sales total would be short");
  }

  return { tenants, errors };
}
