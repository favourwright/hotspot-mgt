/**
 * Midnight, in the zone the business is actually in.
 *
 * The VPS runs UTC and every reader is in Lagos, so a day computed with
 * `setHours(0,0,0,0)` on the server ran 01:00 to 01:00 in the only timezone
 * anyone cares about. These cases pin the boundary to the right hour and,
 * incidentally, prove the result does not depend on the machine's own zone.
 *
 * Run: npm run test:day-boundary
 */
import { startOfMonthInDisplayZone, startOfTodayInDisplayZone } from "../lib/utils";

const cases: Array<[string, string, string]> = [
  // Lagos is UTC+1, so its midnight is 23:00 the previous UTC day.
  ["mid-morning", "2026-10-16T09:00:00Z", "2026-10-15T23:00:00.000Z"],
  ["just before Lagos midnight", "2026-10-16T22:59:59Z", "2026-10-15T23:00:00.000Z"],
  ["exactly Lagos midnight", "2026-10-16T23:00:00Z", "2026-10-16T23:00:00.000Z"],
  ["after Lagos midnight, before UTC midnight", "2026-10-16T23:30:00Z", "2026-10-16T23:00:00.000Z"],
  ["after UTC midnight", "2026-10-17T00:30:00Z", "2026-10-16T23:00:00.000Z"],
  ["year boundary", "2027-01-01T00:30:00Z", "2026-12-31T23:00:00.000Z"],
];

let failed = 0;
for (const [name, input, want] of cases) {
  const got = startOfTodayInDisplayZone(new Date(input)).toISOString();
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

// The month starts at Lagos midnight on the 1st, which is 23:00 UTC on the
// last day of the month before: the one hour a UTC month gets wrong.
const monthCases: Array<[string, string, string]> = [
  ["mid-month", "2026-11-16T09:00:00Z", "2026-10-31T23:00:00.000Z"],
  ["Lagos 1st, still UTC last day", "2026-11-30T23:30:00Z", "2026-11-30T23:00:00.000Z"],
  ["just before the Lagos 1st", "2026-11-30T22:59:59Z", "2026-10-31T23:00:00.000Z"],
  ["year boundary", "2027-01-01T00:30:00Z", "2026-12-31T23:00:00.000Z"],
];
for (const [name, input, want] of monthCases) {
  const got = startOfMonthInDisplayZone(new Date(input)).toISOString();
  const ok = got === want;
  if (!ok) failed += 1;
  cases.push([name, input, want]);
  console.log(`${ok ? "PASS" : "FAIL"}  month: ${name.padEnd(31)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
