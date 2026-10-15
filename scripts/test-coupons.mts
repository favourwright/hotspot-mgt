/**
 * Promo code validity, exercised without Firestore.
 *
 * `checkCoupon` is the gate between a string someone typed into a signup
 * form and a waived bill, so its edges are worth pinning down. The actual
 * redemption wraps this in a transaction - that part cannot be tested here,
 * but the decision it makes is exactly this function.
 *
 * Two boundaries are deliberate:
 *
 *  - `expiresAt` is exclusive, matching waivers: a code expiring at noon is
 *    already dead at noon, so a window never pays out one tick more than it
 *    says.
 *  - the redemption cap is `>=`, not `>`. A code with max 1 and 1 redemption
 *    is finished, which is the reading that cannot hand out an extra.
 *
 * Run: npm run test:coupons
 */
import { checkCoupon, normalizeCouponCode } from "../lib/coupons";
import type { Coupon } from "../types/schemas";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

const base: Coupon = {
  code: "LAUNCH30",
  description: "",
  durationDays: 30,
  maxRedemptions: null,
  timesRedeemed: 0,
  expiresAt: null,
  active: true,
  createdBy: "uid",
  createdAt: at(-30 * DAY),
  updatedAt: at(-30 * DAY),
};

const cases: Array<[string, Partial<Coupon> | null, boolean, string | null]> = [
  ["open code", {}, true, null],
  ["missing code", null, false, "not-found"],
  ["switched off", { active: false }, false, "inactive"],
  ["expires tomorrow", { expiresAt: at(1 * DAY) }, true, null],
  ["expired exactly now", { expiresAt: NOW }, false, "expired"],
  ["expired yesterday", { expiresAt: at(-1 * DAY) }, false, "expired"],
  ["under the cap", { maxRedemptions: 5, timesRedeemed: 4 }, true, null],
  ["at the cap", { maxRedemptions: 5, timesRedeemed: 5 }, false, "fully-redeemed"],
  ["over the cap", { maxRedemptions: 5, timesRedeemed: 9 }, false, "fully-redeemed"],
  ["single use, unused", { maxRedemptions: 1, timesRedeemed: 0 }, true, null],
  ["single use, used", { maxRedemptions: 1, timesRedeemed: 1 }, false, "fully-redeemed"],
  ["uncapped, heavily used", { maxRedemptions: null, timesRedeemed: 900 }, true, null],
  // Inactive outranks the rest: switching a code off is the kill switch and
  // must not depend on why else it might have been refused.
  ["off and expired", { active: false, expiresAt: at(-1 * DAY) }, false, "inactive"],
];

let failed = 0;
for (const [name, patch, wantValid, wantReason] of cases) {
  const coupon = patch === null ? null : { ...base, ...patch };
  const result = checkCoupon(coupon, NOW);
  const ok = result.valid === wantValid && result.reason === wantReason;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(26)} valid=${String(result.valid).padEnd(5)} reason=${String(result.reason)}` +
      (ok ? "" : `  (wanted valid=${wantValid} reason=${wantReason})`)
  );
}

// Codes are typed by hand off an ad, so the normalisation is part of whether
// a code works at all.
const normalizations: Array<[string, string]> = [
  ["launch30", "LAUNCH30"],
  ["  launch30  ", "LAUNCH30"],
  ["LaUnCh-30", "LAUNCH-30"],
];
for (const [input, want] of normalizations) {
  const got = normalizeCouponCode(input);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  normalize ${JSON.stringify(input).padEnd(16)} -> ${got}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

const total = cases.length + normalizations.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
