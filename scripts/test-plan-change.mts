/**
 * What a downgrade would freeze, exercised without Firestore.
 *
 * This decides whether an owner is warned before moving to a smaller plan,
 * and whether they are forced to tick a box first. Both failure modes are
 * bad in opposite directions: a missed breach means somebody downgrades and
 * then cannot work out why they can no longer take on customers, and a
 * false one means a nag on an upgrade, which trains people to tick past the
 * real warning.
 *
 * The case that actually bites is `null`. An unlimited cap is stored as
 * null, and reading it as zero reports every unlimited plan as a breach of
 * everything - so the "moving to unlimited" cases below are the ones worth
 * keeping if this file is ever trimmed.
 *
 * Run: npm run test:plan-change
 */
import {
  describePlanDowngrade,
  paidThroughAfterPlanChange,
  type TenantUsage,
} from "../lib/plan-change";
import type { BillingPlan } from "../types/schemas";

const usage: TenantUsage = { routers: 3, locations: 4, customers: 120 };

/** Only `limits` is read; the rest is here to satisfy the type. */
const plan = (
  limits: Partial<BillingPlan["limits"]>
): BillingPlan =>
  ({
    id: "p",
    name: "Test",
    limits: {
      maxRouters: null,
      maxLocations: null,
      maxCustomers: null,
      ...limits,
    },
  }) as BillingPlan;

const cases: Array<[string, BillingPlan, TenantUsage, string[]]> = [
  ["unlimited everything", plan({}), usage, []],
  [
    "exactly at every cap is not over it",
    plan({ maxRouters: 3, maxLocations: 4, maxCustomers: 120 }),
    usage,
    [],
  ],
  [
    "roomier plan",
    plan({ maxRouters: 10, maxLocations: 10, maxCustomers: 1000 }),
    usage,
    [],
  ],
  [
    "one router too many",
    plan({ maxRouters: 2, maxLocations: 10, maxCustomers: 1000 }),
    usage,
    ["maxRouters"],
  ],
  [
    "customers only - the one that stops the business growing",
    plan({ maxRouters: 10, maxLocations: 10, maxCustomers: 50 }),
    usage,
    ["maxCustomers"],
  ],
  [
    "all three, reported in a fixed order",
    plan({ maxRouters: 1, maxLocations: 1, maxCustomers: 1 }),
    usage,
    ["maxRouters", "maxLocations", "maxCustomers"],
  ],
  [
    "a capped plan for a tenant using nothing yet",
    plan({ maxRouters: 1, maxLocations: 1, maxCustomers: 1 }),
    { routers: 0, locations: 0, customers: 0 },
    [],
  ],
  [
    "null is unlimited, never zero",
    plan({ maxRouters: null, maxLocations: null, maxCustomers: null }),
    { routers: 99, locations: 99, customers: 9999 },
    [],
  ],
  [
    "a zero cap really is zero",
    plan({ maxRouters: 0, maxLocations: 10, maxCustomers: 1000 }),
    usage,
    ["maxRouters"],
  ],
];

let failed = 0;

for (const [name, target, current, want] of cases) {
  const got = describePlanDowngrade(current, target).map((b) => b.limit);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} [${got.join(", ")}]` +
      (ok ? "" : `  (wanted [${want.join(", ")}])`)
  );
}

// Every breach has to carry a sentence, because the dialog renders it
// directly and an empty one would be a tick box with nothing above it.
const sentences = describePlanDowngrade(
  usage,
  plan({ maxRouters: 1, maxLocations: 1, maxCustomers: 1 })
);
for (const breach of sentences) {
  const ok = breach.consequence.trim().length > 0;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${`${breach.limit} has a consequence`.padEnd(52)} ` +
      `"${breach.consequence.slice(0, 40)}..."`
  );
}

/*
 * Where a plan change leaves the paid time. A wrong answer here locks a tenant the
 * moment they upgrade, or lets one restart their grace window by switching plans.
 */
const NOW = new Date("2026-06-15T00:00:00Z");
const LATER = new Date("2026-07-01T00:00:00Z");
const EARLIER = new Date("2026-06-01T00:00:00Z");
const iso = (d: Date | null) => (d ? d.toISOString() : "none");

const periodCases: Array<[string, Parameters<typeof paidThroughAfterPlanChange>[0], Date | null]> = [
  ["paid to paid keeps the paid time", { oldMonthlyFee: 300_000, newMonthlyFee: 500_000, paidThrough: LATER, now: NOW }, LATER],
  ["paid to free keeps it too", { oldMonthlyFee: 300_000, newMonthlyFee: 0, paidThrough: LATER, now: NOW }, LATER],
  ["free to paid, never paid: owed from now", { oldMonthlyFee: 0, newMonthlyFee: 300_000, paidThrough: null, now: NOW }, NOW],
  ["free to paid, old paid time long gone: owed from now", { oldMonthlyFee: 0, newMonthlyFee: 300_000, paidThrough: EARLIER, now: NOW }, NOW],
  ["free to paid with paid time ahead keeps it", { oldMonthlyFee: 0, newMonthlyFee: 300_000, paidThrough: LATER, now: NOW }, LATER],
  ["owing on paid, to another paid: the debt keeps its date", { oldMonthlyFee: 300_000, newMonthlyFee: 500_000, paidThrough: EARLIER, now: NOW }, EARLIER],
  ["owing, never paid, to another paid: still never paid", { oldMonthlyFee: 300_000, newMonthlyFee: 500_000, paidThrough: null, now: NOW }, null],
  ["free to free changes nothing", { oldMonthlyFee: 0, newMonthlyFee: 0, paidThrough: null, now: NOW }, null],
];
for (const [name, input, want] of periodCases) {
  const got = paidThroughAfterPlanChange(input);
  const ok = iso(got) === iso(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(56)} ${iso(got)}`);
}

const total =
  cases.length + sentences.length + periodCases.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
