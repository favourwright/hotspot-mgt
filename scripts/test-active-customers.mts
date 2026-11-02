/**
 * Who counts against a plan's customer limit, exercised without Firestore.
 *
 * The boundary has to agree with the `>=` in `getActiveCustomerCount`, and a
 * customer document older than the field has to read as inactive rather than
 * throw or count: those documents exist on every tenant.
 *
 * Run: npm run test:active-customers
 */
import {
  ACTIVE_CUSTOMER_WINDOW_DAYS,
  activeCustomerWindowStart,
  isActiveCustomer,
} from "../lib/active-customers";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-02T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const cases: Array<[string, Date | null | undefined, boolean]> = [
  ["bought just now", now, true],
  ["bought yesterday", ago(DAY), true],
  ["bought one second inside the window", ago(30 * DAY - 1000), true],
  ["bought exactly at the window's edge", ago(30 * DAY), true],
  ["bought one second outside the window", ago(30 * DAY + 1000), false],
  ["bought a year ago", ago(365 * DAY), false],
  ["document older than the field (undefined)", undefined, false],
  ["document older than the field (null)", null, false],
];

let failed = 0;
for (const [name, lastPurchaseAt, expected] of cases) {
  const ok = isActiveCustomer(lastPurchaseAt, now) === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

const start = activeCustomerWindowStart(now).getTime();
const startOk = now.getTime() - start === ACTIVE_CUSTOMER_WINDOW_DAYS * DAY;
if (!startOk) failed += 1;
console.log(`${startOk ? "PASS" : "FAIL"}  window start is 30 days back`);

const total = cases.length + 1;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
