/**
 * The entitlement grace-window arithmetic, exercised without Firestore.
 *
 * This is the paywall's decision function: every "can this tenant use the
 * addon" answer comes through `evaluateEntitlement`. The interesting cases
 * are all about time rather than status, which makes them exactly the kind
 * that go unnoticed until a tenant either gets a free feature forever or
 * loses one they paid for.
 *
 * Two behaviours here look like bugs and are not:
 *
 *  - `past_due` with no `pastDueSince` stays entitled. That timestamp is
 *    ours to write, so its absence is our data being wrong, and denying a
 *    paying tenant over our own missing field is the worse failure.
 *  - an `active` subscription whose `currentPeriodEnd` has passed still
 *    lapses. The status alone is not trusted, so a webhook we never received
 *    cannot turn into permanent free access.
 *
 * Run: npm run test:entitlements
 */
import {
  evaluateEntitlement,
  PAST_DUE_GRACE_MS,
} from "../lib/entitlements";
import type { AddonEntitlement } from "../types/schemas";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base: AddonEntitlement = {
  addonKey: "captive-portal",
  source: "purchase",
  status: "active",
  pricingModel: "subscription",
  lastPaymentRef: "ref",
  amountPaid: 500_000,
  grantedAt: new Date("2026-09-10T12:00:00Z"),
  currentPeriodEnd: null,
  pastDueSince: null,
  cancelledAt: null,
  updatedAt: NOW,
};

const cases: Array<[string, Partial<AddonEntitlement>, boolean, string]> = [
  ["subscription active, period ahead", { currentPeriodEnd: at(20 * DAY) }, true, "purchased"],
  ["subscription active, period just ended", { currentPeriodEnd: at(-1 * DAY) }, true, "in-grace"],
  ["subscription active, period long gone", { currentPeriodEnd: at(-9 * DAY) }, false, "lapsed"],
  ["subscription active, no period end", { currentPeriodEnd: null }, true, "purchased"],
  ["past_due within grace", { status: "past_due", pastDueSince: at(-1 * DAY) }, true, "in-grace"],
  ["past_due at grace edge", { status: "past_due", pastDueSince: at(-PAST_DUE_GRACE_MS) }, false, "lapsed"],
  ["past_due beyond grace", { status: "past_due", pastDueSince: at(-9 * DAY) }, false, "lapsed"],
  ["past_due, no timestamp", { status: "past_due", pastDueSince: null }, true, "in-grace"],
  ["cancelled, period ahead", { status: "cancelled", currentPeriodEnd: at(5 * DAY) }, true, "purchased"],
  ["cancelled, period past", { status: "cancelled", currentPeriodEnd: at(-1 * DAY) }, false, "cancelled"],
  ["cancelled, no period", { status: "cancelled", currentPeriodEnd: null }, false, "cancelled"],
  ["expired", { status: "expired" }, false, "lapsed"],
  ["one-time active", { pricingModel: "one_time", currentPeriodEnd: null }, true, "purchased"],
  ["one-time, stale period", { pricingModel: "one_time", currentPeriodEnd: at(-99 * DAY) }, true, "purchased"],
];

let failed = 0;
for (const [name, patch, wantEntitled, wantReason] of cases) {
  const result = evaluateEntitlement("captive-portal", { ...base, ...patch }, NOW);
  const ok = result.entitled === wantEntitled && result.reason === wantReason;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(36)} ` +
      `entitled=${String(result.entitled).padEnd(5)} reason=${result.reason}` +
      (ok ? "" : `  (wanted entitled=${wantEntitled} reason=${wantReason})`)
  );
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
