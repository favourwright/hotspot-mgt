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
  decideSubscriptionMove,
  describePlanDowngrade,
  hasLivePlatformSubscription,
  isStalePlatformSubscriptionEvent,
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
 * What happens at Paystack. A wrong answer here charges somebody the wrong
 * amount, or stops a subscription nobody asked to stop.
 */
const NOW = new Date("2026-06-15T00:00:00Z");
const LATER = new Date("2026-07-01T00:00:00Z");
const EARLIER = new Date("2026-06-01T00:00:00Z");
const move = { subscriptionStatus: "active", paystackStatus: "active", nextPaymentDate: LATER, newMonthlyFee: 500_000, now: NOW };

const moveCases: Array<[string, Parameters<typeof decideSubscriptionMove>[0], string]> = [
  ["paid to paid waits for the paid period", move, "reschedule"],
  ["to a free plan stops", { ...move, newMonthlyFee: 0 }, "stop"],
  ["past due gets no new subscription", { ...move, subscriptionStatus: "past_due" }, "stop"],
  ["paystack retrying is still live", { ...move, paystackStatus: "attention" }, "reschedule"],
  ["already non-renewing is left alone", { ...move, paystackStatus: "non-renewing" }, "none"],
  ["already cancelled is left alone", { ...move, paystackStatus: "cancelled", newMonthlyFee: 0 }, "none"],
  ["no future date stops", { ...move, nextPaymentDate: EARLIER }, "stop"],
  ["no date at all stops", { ...move, nextPaymentDate: null }, "stop"],
];
for (const [name, input, want] of moveCases) {
  const got = decideSubscriptionMove(input);
  const ok = got.action === want &&
    (got.action !== "reschedule" || got.startDate.getTime() === LATER.getTime());
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${got.action}`);
}

const liveCases: Array<[string, Parameters<typeof hasLivePlatformSubscription>[0], boolean]> = [
  ["active with a code is live", { subscriptionStatus: "active", paystackSubscriptionCode: "SUB_a" }, true],
  ["past due with a code is live", { subscriptionStatus: "past_due", paystackSubscriptionCode: "SUB_a" }, true],
  ["cancelled is not live", { subscriptionStatus: "cancelled", paystackSubscriptionCode: "SUB_a" }, false],
  ["no code is not live", { subscriptionStatus: "active", paystackSubscriptionCode: null }, false],
];
for (const [name, input, want] of liveCases) {
  const got = hasLivePlatformSubscription(input);
  if (got !== want) failed += 1;
  console.log(`${got === want ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${got}`);
}

const staleCases: Array<[string, Parameters<typeof isStalePlatformSubscriptionEvent>[0], boolean]> = [
  ["the current subscription counts", { eventCode: "SUB_a", recordedCode: "SUB_a", supersededCode: null }, false],
  ["the first one, not yet recorded, counts", { eventCode: "SUB_a", recordedCode: null, supersededCode: null }, false],
  ["a replaced one is ignored", { eventCode: "SUB_a", recordedCode: "SUB_b", supersededCode: "SUB_a" }, true],
  ["replaced, before the new code is written", { eventCode: "SUB_a", recordedCode: "SUB_a", supersededCode: "SUB_a" }, true],
  ["replaced, with nothing recorded", { eventCode: "SUB_a", recordedCode: null, supersededCode: "SUB_a" }, true],
  ["an older one after resubscribing is ignored", { eventCode: "SUB_a", recordedCode: "SUB_b", supersededCode: null }, true],
  ["an event with no code is not judged", { eventCode: null, recordedCode: "SUB_b", supersededCode: "SUB_a" }, false],
];
for (const [name, input, want] of staleCases) {
  const got = isStalePlatformSubscriptionEvent(input);
  if (got !== want) failed += 1;
  console.log(`${got === want ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${got}`);
}

const total =
  cases.length + sentences.length + moveCases.length + liveCases.length + staleCases.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
