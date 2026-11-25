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
import {
  decidePlanFeeLock,
  isWaiverActive,
  resolvePaymentDueSince,
} from "../lib/fee-waivers";
import type { FeeWaiver } from "../types/schemas";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base: FeeWaiver = {
  id: "w1",
  discountType: "percent",
  discountValue: 100,
  discountKobo: 300_000,
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
 * The grace window is measured from here, so getting this wrong either locks
 * a tenant who is paid up or never locks one who is not. The rule is "the
 * latest thing that has already happened", and both halves matter: latest,
 * because an old trial must not out-rank a recent lapse; already happened,
 * because a waiver still running is not a reason anything is owed today.
 */
const waiverAt = (patch: Partial<FeeWaiver>): FeeWaiver => ({ ...base, ...patch });

const dueSinceCases: Array<
  [string, Parameters<typeof resolvePaymentDueSince>[0], Date]
> = [
  [
    "trial ended a week ago",
    {
      waivers: [waiverAt({ endsAt: at(-7 * DAY) })],
      nextBillingDate: null,
      tenantCreatedAt: at(-40 * DAY),
      now: NOW,
    },
    at(-7 * DAY),
  ],
  [
    "a later lapse beats an older trial",
    {
      waivers: [waiverAt({ endsAt: at(-30 * DAY) })],
      nextBillingDate: at(-2 * DAY),
      tenantCreatedAt: at(-60 * DAY),
      now: NOW,
    },
    at(-2 * DAY),
  ],
  [
    "a waiver still running is not a start date",
    {
      waivers: [waiverAt({ endsAt: at(5 * DAY) })],
      nextBillingDate: null,
      tenantCreatedAt: at(-40 * DAY),
      now: NOW,
    },
    at(-40 * DAY),
  ],
  [
    "a future billing date is not a start date",
    {
      waivers: [],
      nextBillingDate: at(5 * DAY),
      tenantCreatedAt: at(-40 * DAY),
      now: NOW,
    },
    at(-40 * DAY),
  ],
  [
    "revoked early counts from the revocation, not the end it never reached",
    {
      waivers: [waiverAt({ endsAt: at(20 * DAY), revokedAt: at(-3 * DAY) })],
      nextBillingDate: null,
      tenantCreatedAt: at(-40 * DAY),
      now: NOW,
    },
    at(-3 * DAY),
  ],
  [
    "no history at all falls back to the account's own age",
    {
      waivers: [],
      nextBillingDate: null,
      tenantCreatedAt: at(-10 * DAY),
      now: NOW,
    },
    at(-10 * DAY),
  ],
];

for (const [name, input, want] of dueSinceCases) {
  const got = resolvePaymentDueSince(input);
  const ok = got.getTime() === want.getTime();
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${got.toISOString()}` +
      (ok ? "" : `  (wanted ${want.toISOString()})`)
  );
}

/* ------------------------------------------------------- the grace window */

/**
 * What actually stops a tenant selling. The boundary is inclusive, matching
 * `endsAt`: the moment it arrives, it has arrived.
 *
 * Only `payment-due` can lock. Which status a tenant is in is decided in
 * lib/billing-periods.ts and tested in scripts/test-billing-periods.mts.
 */
const GRACE = 3 * DAY;

const lockCases: Array<
  [string, Parameters<typeof decidePlanFeeLock>[0], boolean]
> = [
  ["due today, inside grace", { status: "payment-due", dueSince: NOW, now: NOW, graceMs: GRACE }, false],
  ["two days in", { status: "payment-due", dueSince: at(-2 * DAY), now: NOW, graceMs: GRACE }, false],
  ["a minute short", { status: "payment-due", dueSince: at(-3 * DAY + 60_000), now: NOW, graceMs: GRACE }, false],
  ["exactly three days", { status: "payment-due", dueSince: at(-3 * DAY), now: NOW, graceMs: GRACE }, true],
  ["long overdue", { status: "payment-due", dueSince: at(-30 * DAY), now: NOW, graceMs: GRACE }, true],
  ["zero grace locks the same day", { status: "payment-due", dueSince: NOW, now: NOW, graceMs: 0 }, true],
  // Every other status, however old the debt looks.
  ["waived never locks", { status: "waived", dueSince: at(-30 * DAY), now: NOW, graceMs: GRACE }, false],
  ["free plan never locks", { status: "no-fee", dueSince: at(-30 * DAY), now: NOW, graceMs: GRACE }, false],
  ["paid never locks: the period is paid for", { status: "paid", dueSince: at(-30 * DAY), now: NOW, graceMs: GRACE }, false],
  ["no start date, no lock", { status: "payment-due", dueSince: null, now: NOW, graceMs: GRACE }, false],
];

for (const [name, input, want] of lockCases) {
  const got = decidePlanFeeLock(input).locked;
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} locked=${got}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

const total =
  cases.length + dueSinceCases.length + lockCases.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
