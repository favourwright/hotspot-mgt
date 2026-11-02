/**
 * When a plan stops a tenant adding another router or location, exercised
 * without Firestore.
 *
 * `null` is the case that matters: it is how an unlimited plan is stored, and
 * every tenant on the platform is on one today, so reading it as zero would
 * stop all of them registering anything.
 *
 * Run: npm run test:plan-limits
 */
import { isAtPlanLimit, planLimitMessage } from "../lib/plan-resource-limits";

const cases: Array<[string, number, number | null, boolean]> = [
  ["unlimited with nothing registered", 0, null, false],
  ["unlimited with plenty registered", 500, null, false],
  ["below the limit", 1, 2, false],
  ["exactly at the limit", 2, 2, true],
  ["above the limit after a downgrade", 3, 2, true],
];

let failed = 0;
for (const [name, current, allowed, expected] of cases) {
  const ok = isAtPlanLimit(current, allowed) === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

const messages: Array<[string, string, string]> = [
  [
    "names the plan and pluralises",
    planLimitMessage("maxRouters", 2, "Starter"),
    "The Starter plan allows up to 2 routers.",
  ],
  [
    "singular for a limit of one",
    planLimitMessage("maxLocations", 1, "Starter"),
    "The Starter plan allows up to 1 location.",
  ],
  [
    "still reads without a plan name",
    planLimitMessage("maxRouters", 2, null),
    "Your plan allows up to 2 routers.",
  ],
];
for (const [name, message, expected] of messages) {
  const ok = message.startsWith(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

const total = cases.length + messages.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
