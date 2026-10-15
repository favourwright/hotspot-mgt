/**
 * The plan-fee waiver window, exercised without Firestore.
 *
 * This decides whether a tenant owes their plan fee, so the failure modes
 * are a comped account quietly being billed, or a promo tenant staying free
 * forever. Both are about dates rather than flags, which is exactly the kind
 * of logic that looks obviously correct and is not.
 *
 * Two behaviours here are deliberate and worth knowing:
 *
 *  - `endsAt` is exclusive. A waiver ending at noon is already over at noon,
 *    so a window can never pay out one tick more than it says.
 *  - Overlapping waivers resolve to the one ending latest, and one with no
 *    end date beats every dated one. Stacking a coupon on a manual comp can only
 *    extend the free period, never cut it short - the opposite would make
 *    granting someone an extra month silently shorten their comp.
 *
 * Run: npm run test:waivers
 */
import { decidePlanFeeStatus, isWaiverActive } from "../lib/fee-waivers";
import type { FeeWaiver } from "../types/schemas";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base: FeeWaiver = {
  id: "w1",
  startsAt: at(-10 * DAY),
  endsAt: at(10 * DAY),
  source: "manual",
  couponCode: null,
  reason: "",
  grantedBy: "uid",
  revokedAt: null,
  createdAt: at(-10 * DAY),
};

const cases: Array<[string, Partial<FeeWaiver>, boolean]> = [
  ["open window", {}, true],
  // Nothing writes these any more - the UI has no option for it and the API
  // requires a date. Kept because the reader must stay tolerant of one
  // written before that was settled, rather than silently billing them.
  ["legacy, no end date", { endsAt: null }, true],
  ["ends in a minute", { endsAt: at(60_000) }, true],
  ["ended exactly now", { endsAt: NOW }, false],
  ["ended yesterday", { endsAt: at(-1 * DAY) }, false],
  ["starts tomorrow", { startsAt: at(1 * DAY) }, false],
  ["starts exactly now", { startsAt: NOW }, true],
  ["revoked, window still open", { revokedAt: at(-1 * DAY) }, false],
  ["revoked, no end date", { endsAt: null, revokedAt: at(-1 * DAY) }, false],
];

let failed = 0;
for (const [name, patch, want] of cases) {
  const got = isWaiverActive({ ...base, ...patch }, NOW);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} active=${String(got).padEnd(5)}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

/**
 * Which of those states the tenant is actually in, which decides whether
 * they get asked for money. The ordering is the interesting part: a free
 * plan and a live waiver both outrank whatever the subscription field says,
 * and `past_due` must never become a prompt to pay.
 */
const statusCases: Array<
  [string, Parameters<typeof decidePlanFeeStatus>[0], string]
> = [
  ["free plan", { planMonthlyFee: 0, hasActiveWaiver: false, subscriptionStatus: null }, "no-fee"],
  ["free plan, stale cancelled flag", { planMonthlyFee: 0, hasActiveWaiver: false, subscriptionStatus: "cancelled" }, "no-fee"],
  ["paid, waived", { planMonthlyFee: 300_000, hasActiveWaiver: true, subscriptionStatus: null }, "waived"],
  ["waiver outranks cancelled", { planMonthlyFee: 300_000, hasActiveWaiver: true, subscriptionStatus: "cancelled" }, "waived"],
  ["waiver outranks past_due", { planMonthlyFee: 300_000, hasActiveWaiver: true, subscriptionStatus: "past_due" }, "waived"],
  ["paying normally", { planMonthlyFee: 300_000, hasActiveWaiver: false, subscriptionStatus: "active" }, "subscribed"],
  ["card retrying", { planMonthlyFee: 300_000, hasActiveWaiver: false, subscriptionStatus: "past_due" }, "past-due"],
  ["never subscribed", { planMonthlyFee: 300_000, hasActiveWaiver: false, subscriptionStatus: null }, "payment-due"],
  ["waiver just ended", { planMonthlyFee: 300_000, hasActiveWaiver: false, subscriptionStatus: null }, "payment-due"],
  ["cancelled", { planMonthlyFee: 300_000, hasActiveWaiver: false, subscriptionStatus: "cancelled" }, "payment-due"],
];

for (const [name, input, want] of statusCases) {
  const got = decidePlanFeeStatus(input);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} status=${got}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

const total = cases.length + statusCases.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
