/**
 * What a payment to the platform buys (lib/billing-periods.ts), without Firestore.
 *
 * The failure modes are money: a tenant charged for days they were given free, a
 * payment that buys nothing, a discount that outlives its window, or a comped tenant
 * asked to pay. All of them are about dates.
 *
 * Run: npm run test:billing-periods
 */
import {
  decidePlanFeeStatus,
  quoteAddonPeriod,
  quotePlanPeriod,
  PLAN_INTERVAL_MS,
  RENEW_WINDOW_MS,
} from "../lib/billing-periods";

const NOW = new Date("2026-11-25T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const FEE = 300_000;

let failed = 0;
let total = 0;
function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}` + (ok ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
}

// --- Which status a tenant is in ------------------------------------------------------
const status = (patch: Partial<Parameters<typeof decidePlanFeeStatus>[0]>) =>
  decidePlanFeeStatus({ planMonthlyFee: FEE, waiver: null, paidThrough: null, now: NOW, ...patch });

check("free plan owes nothing", status({ planMonthlyFee: 0 }), "no-fee");
check("free plan outranks a paid period", status({ planMonthlyFee: 0, paidThrough: at(5 * DAY) }), "no-fee");
check("a waiver of the whole fee", status({ waiver: { discountKobo: FEE, endsAt: at(10 * DAY) } }), "waived");
check("a stale discount above the fee still waives it all", status({ waiver: { discountKobo: FEE * 2, endsAt: null } }), "waived");
check("a partial discount is not a waiver", status({ waiver: { discountKobo: 60_000, endsAt: at(10 * DAY) } }), "payment-due");
check("a partial discount, paid up", status({ waiver: { discountKobo: 60_000, endsAt: at(10 * DAY) }, paidThrough: at(20 * DAY) }), "paid");
check("paid up", status({ paidThrough: at(5 * DAY) }), "paid");
check("paid period ends this instant", status({ paidThrough: NOW }), "payment-due");
check("paid period over", status({ paidThrough: at(-1 * DAY) }), "payment-due");
check("never paid", status({}), "payment-due");

// --- What paying the plan now buys ----------------------------------------------------
const quote = (patch: Partial<Parameters<typeof quotePlanPeriod>[0]>) => {
  const q = quotePlanPeriod({ now: NOW, monthlyFee: FEE, paidThrough: null, waiver: null, ...patch });
  return q && { amount: q.amountKobo, discount: q.discountKobo, from: q.from.toISOString(), to: q.to.toISOString() };
};
const period = (from: Date) => ({ from: from.toISOString(), to: new Date(from.getTime() + PLAN_INTERVAL_MS).toISOString() });

check("owed: a full period from now", quote({}), { amount: FEE, discount: 0, ...period(NOW) });
check("lapsed a week ago: from now, the lapsed days are not charged", quote({ paidThrough: at(-7 * DAY) }), { amount: FEE, discount: 0, ...period(NOW) });
check("free plan: nothing to pay", quote({ monthlyFee: 0 }), null);
check("renewing 3 days early starts where the paid time ends", quote({ paidThrough: at(3 * DAY) }), { amount: FEE, discount: 0, ...period(at(3 * DAY)) });
check("renewing exactly a week early is allowed", quote({ paidThrough: at(RENEW_WINDOW_MS) }), { amount: FEE, discount: 0, ...period(at(RENEW_WINDOW_MS)) });
check("more than a week ahead is refused", quote({ paidThrough: at(RENEW_WINDOW_MS + 60_000) }), null);
check(
  "in a free trial: buys the month after it, at full price",
  quote({ waiver: { discountKobo: FEE, endsAt: at(20 * DAY) } }),
  { amount: FEE, discount: 0, ...period(at(20 * DAY)) },
);
check(
  "in a free trial, already prepaid: refused",
  quote({ waiver: { discountKobo: FEE, endsAt: at(20 * DAY) }, paidThrough: at(50 * DAY) }),
  null,
);
check(
  "free trial ends within the paid time already bought: from the paid time",
  quote({ waiver: { discountKobo: FEE, endsAt: at(2 * DAY) }, paidThrough: at(5 * DAY) }),
  { amount: FEE, discount: 0, ...period(at(5 * DAY)) },
);
check("comped for good: nothing to pay", quote({ waiver: { discountKobo: FEE, endsAt: null } }), null);
check(
  "20% off, live: the period is cheaper",
  quote({ waiver: { discountKobo: 60_000, endsAt: at(20 * DAY) } }),
  { amount: FEE - 60_000, discount: 60_000, ...period(NOW) },
);
check(
  "20% off, ending before the period would start: full price",
  quote({ waiver: { discountKobo: 60_000, endsAt: at(2 * DAY) }, paidThrough: at(3 * DAY) }),
  { amount: FEE, discount: 0, ...period(at(3 * DAY)) },
);
check(
  "20% off, ending exactly when the period would start: full price",
  quote({ waiver: { discountKobo: 60_000, endsAt: at(3 * DAY) }, paidThrough: at(3 * DAY) }),
  { amount: FEE, discount: 0, ...period(at(3 * DAY)) },
);
check(
  "20% off with no end: every period is cheaper",
  quote({ waiver: { discountKobo: 60_000, endsAt: null }, paidThrough: at(2 * DAY) }),
  { amount: FEE - 60_000, discount: 60_000, ...period(at(2 * DAY)) },
);

// --- What paying for an addon now buys ------------------------------------------------
const addon = (patch: Partial<Parameters<typeof quoteAddonPeriod>[0]>) => {
  const q = quoteAddonPeriod({ now: NOW, paidThrough: null, interval: "monthly", ...patch });
  return q && { from: q.from.toISOString(), to: q.to.toISOString() };
};
check("first month from now", addon({}), { from: NOW.toISOString(), to: at(30 * DAY).toISOString() });
check("a year from now", addon({ interval: "yearly" }), { from: NOW.toISOString(), to: at(365 * DAY).toISOString() });
check("renewing early starts where the paid time ends", addon({ paidThrough: at(2 * DAY) }), { from: at(2 * DAY).toISOString(), to: at(32 * DAY).toISOString() });
check("lapsed: from now", addon({ paidThrough: at(-2 * DAY) }), { from: NOW.toISOString(), to: at(30 * DAY).toISOString() });
check("more than a week ahead is refused", addon({ paidThrough: at(8 * DAY) }), null);

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
