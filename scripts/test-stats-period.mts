/**
 * The dashboards' "this month so far" arithmetic, and the Lagos calendar
 * dates it is built on.
 *
 * Pinned: a month read from stored days hands over to the live aggregation
 * at the first gap rather than skipping it, the comparison refuses half a
 * month, month lengths clamp, and a `YYYY-MM-DD` filter date means Lagos
 * midnight on the UTC server.
 *
 * Run: npm run test:stats-period
 */
import {
  addDays,
  daysInMonth,
  percentChange,
  previousMonthKey,
  runningTotals,
  samePointLastMonth,
  splitMonthToDate,
  storedDay,
  windowKeys,
} from "../lib/stats-period";
import {
  displayZoneDateKey,
  endOfDisplayZoneDate,
  startOfDisplayZoneDate,
} from "../lib/utils";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`      got:    ${JSON.stringify(got)}\n      wanted: ${JSON.stringify(want)}`);
}

const F = ["a", "b"] as const;

// --- calendar ---------------------------------------------------------------
check("previous month mid-year", previousMonthKey("2026-11"), "2026-10");
check("previous month across a year", previousMonthKey("2027-01"), "2026-12");
check("February 2026", daysInMonth("2026-02"), 28);
check("February 2028 (leap)", daysInMonth("2028-02"), 29);
check("addDays across a month", addDays("2026-10-31", 1), "2026-11-01");
check("addDays backwards across a year", addDays("2027-01-01", -2), "2026-12-30");

// --- Lagos dates ------------------------------------------------------------
// Lagos is UTC+1: its midnight is 23:00 UTC the day before.
check("date key just after Lagos midnight", displayZoneDateKey(new Date("2026-11-26T23:30:00Z")), "2026-11-27");
check("date key just before it", displayZoneDateKey(new Date("2026-11-26T22:59:59Z")), "2026-11-26");
check("filter from-date is Lagos midnight", startOfDisplayZoneDate("2026-11-01")?.toISOString(), "2026-10-31T23:00:00.000Z");
check("filter to-date ends at Lagos midnight", endOfDisplayZoneDate("2026-11-30")?.toISOString(), "2026-11-30T22:59:59.999Z");
check("not a date", startOfDisplayZoneDate("2026-02-30"), null);
check("not a format", startOfDisplayZoneDate("1 Nov"), null);

// --- month to date ----------------------------------------------------------
check(
  "every finished day stored: live from today",
  splitMonthToDate(F, { "01": { a: 1 }, "02": { a: 2, b: 5 } }, "2026-11-03"),
  { stored: { a: 3, b: 5 }, liveFromKey: "2026-11-03" }
);
check(
  "the nightly job has not run yet: live from yesterday",
  splitMonthToDate(F, { "01": { a: 1 } }, "2026-11-03"),
  { stored: { a: 1, b: 0 }, liveFromKey: "2026-11-02" }
);
check(
  "a gap in the middle: live from the gap, later days not double-counted",
  splitMonthToDate(F, { "01": { a: 1 }, "03": { a: 100 } }, "2026-11-05"),
  { stored: { a: 1, b: 0 }, liveFromKey: "2026-11-02" }
);
check(
  "the 1st: nothing stored, live from today",
  splitMonthToDate(F, {}, "2026-11-01"),
  { stored: { a: 0, b: 0 }, liveFromKey: "2026-11-01" }
);
check(
  "today's own entry is ignored: today is always live",
  splitMonthToDate(F, { "01": { a: 1 }, "02": { a: 50 } }, "2026-11-02"),
  { stored: { a: 1, b: 0 }, liveFromKey: "2026-11-02" }
);

// --- comparison -------------------------------------------------------------
const fullOctober = Object.fromEntries(
  Array.from({ length: 31 }, (_, i) => [String(i + 1).padStart(2, "0"), { a: 1, b: 2 }])
);
check(
  "same day last month, inclusive",
  samePointLastMonth(F, fullOctober, "2026-11-27"),
  { figures: { a: 27, b: 54 }, throughKey: "2026-10-27" }
);
check(
  "a missing day: no comparison rather than a short one",
  samePointLastMonth(F, { ...fullOctober, "05": undefined }, "2026-11-27"),
  null
);
const february = Object.fromEntries(
  Array.from({ length: 28 }, (_, i) => [String(i + 1).padStart(2, "0"), { a: 1 }])
);
check(
  "31 March clamps to all of February",
  samePointLastMonth(F, february, "2026-03-31"),
  { figures: { a: 28, b: 0 }, throughKey: "2026-02-28" }
);

check("percent up", percentChange(120, 100), 20);
check("percent down", percentChange(50, 200), -75);
check("nothing last month: no percent", percentChange(500, 0), null);

// --- chart series -----------------------------------------------------------
check("30-day window across a month", windowKeys("2026-11-03", 5), [
  "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03",
]);
check(
  "stored day from the right month",
  storedDay({ "2026-10": { "31": { a: 7 } }, "2026-11": { "01": { a: 1 } } }, "2026-10-31"),
  { a: 7 }
);
check("stored day from a month not in hand", storedDay({}, "2026-09-30"), undefined);
check("running totals", runningTotals([1, 2, 3]), [1, 3, 6]);
check("running totals stop at a gap", runningTotals([1, null, 3]), [1, null, null]);
check(
  "known total pins the last point even after a gap",
  runningTotals([1, null, 3], 10),
  [1, null, 10]
);

console.log(failed ? `\n${failed} failed` : "\nAll passed");
process.exit(failed ? 1 : 0);
