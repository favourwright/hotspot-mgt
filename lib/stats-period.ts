/**
 * The arithmetic behind the dashboards' "this month" figures, kept free of
 * Firestore so it can be tested on its own (`npm run test:stats-period`).
 *
 * A month's figures live in one document per Lagos month, holding a map of
 * finished days (lib/stats-rollup.ts). "This month so far" is those days
 * plus a live aggregation for whatever the map does not cover yet - today,
 * and any day the nightly job has not reached. That second half is what
 * makes a missed or late cron run cost a read or two rather than a wrong
 * number.
 *
 * Every key here is a calendar date in Lagos (`displayZoneDateKey`), never
 * the server's UTC date.
 */

/** `YYYY-MM`. */
export type MonthKey = string;

/** `01`..`31`: a day's key inside a month document's `days` map. */
export type DayKey = string;

export type MonthDays<T> = Partial<Record<DayKey, T>>;

export function monthKeyOf(dateKey: string): MonthKey {
  return dateKey.slice(0, 7);
}

export function dayOfMonth(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}

export function dayKey(day: number): DayKey {
  return String(day).padStart(2, "0");
}

export function dateKeyFor(month: MonthKey, day: number): string {
  return `${month}-${dayKey(day)}`;
}

export function previousMonthKey(month: MonthKey): MonthKey {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, "0")}`;
}

export function daysInMonth(month: MonthKey): number {
  const [year, m] = month.split("-").map(Number);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** A date key moved by whole days. Pure calendar arithmetic, no zone. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days, 12));
  return moved.toISOString().slice(0, 10);
}

/** Field-by-field sum of the figures. Missing fields count as zero. */
export function addFigures<F extends string>(
  fields: readonly F[],
  ...rows: Array<Partial<Record<F, number>> | undefined>
): Record<F, number> {
  const out = {} as Record<F, number>;
  for (const f of fields) {
    out[f] = rows.reduce<number>((sum, row) => sum + (Number(row?.[f]) || 0), 0);
  }
  return out;
}

/**
 * The finished days of this month that the stored map can answer for, and
 * where the live aggregation has to take over.
 *
 * Contiguous from the 1st on purpose: a gap in the middle (a night the job
 * failed) cannot be filled from a sum over "since X" without counting the
 * days after it twice, so everything from the first gap onwards is counted
 * live instead. In steady state there is no gap and `liveFromKey` is today.
 */
export function splitMonthToDate<F extends string>(
  fields: readonly F[],
  days: MonthDays<Partial<Record<F, number>>>,
  todayKey: string
): { stored: Record<F, number>; liveFromKey: string } {
  const month = monthKeyOf(todayKey);
  const today = dayOfMonth(todayKey);
  const rows: Array<Partial<Record<F, number>>> = [];
  let day = 1;
  for (; day < today; day += 1) {
    const row = days[dayKey(day)];
    if (!row) break;
    rows.push(row);
  }
  return { stored: addFigures(fields, ...rows), liveFromKey: dateKeyFor(month, day) };
}

/**
 * Last month up to the same day of the month, or null when the stored map
 * does not cover all of it - a comparison against half a month would read
 * as a collapse in sales that never happened.
 *
 * The same day *inclusive*, against a this-month figure that includes today
 * only so far, so early in a day it understates this month slightly. The
 * label says which date it runs to.
 *
 * Clamped to the shorter month: the 31st of March compares with all of
 * February.
 */
export function samePointLastMonth<F extends string>(
  fields: readonly F[],
  lastMonthDays: MonthDays<Partial<Record<F, number>>>,
  todayKey: string
): { figures: Record<F, number>; throughKey: string } | null {
  const last = previousMonthKey(monthKeyOf(todayKey));
  const through = Math.min(dayOfMonth(todayKey), daysInMonth(last));
  const rows: Array<Partial<Record<F, number>>> = [];
  for (let day = 1; day <= through; day += 1) {
    const row = lastMonthDays[dayKey(day)];
    if (!row) return null;
    rows.push(row);
  }
  return { figures: addFigures(fields, ...rows), throughKey: dateKeyFor(last, through) };
}

/**
 * Percentage change, rounded, or null when there is nothing to compare
 * against: "+100%" on a month that followed a month of nothing tells the
 * reader nothing.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-10-27` as `27 Oct`. */
export function shortDate(dateKey: string): string {
  return `${dayOfMonth(dateKey)} ${MONTH_ABBR[Number(dateKey.slice(5, 7)) - 1]}`;
}

/**
 * "+12% vs ₦84,000.00 by 27 Oct": this month against the same point last
 * month. The date is in the line because the comparison runs to the end of
 * that day while this month runs only to now.
 */
export function describeChange(
  current: number,
  previous: number,
  throughKey: string,
  format: (value: number) => string
): string {
  const pct = percentChange(current, previous);
  const lead = pct === null ? "" : `${pct > 0 ? "+" : ""}${pct}% `;
  return `${lead}vs ${format(previous)} by ${shortDate(throughKey)}`;
}
