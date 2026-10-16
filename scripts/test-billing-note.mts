/**
 * The one sentence a new owner reads about what they will be charged.
 *
 * It exists because the first version of the welcome email put the
 * discounted figure under "Monthly fee", so a tenant who signed up with a
 * 100% code was told their 3,000 naira plan cost 0.00 - true about that one
 * payment, and wrong about everything after it.
 *
 * The rule the cases below pin down: the fee shown is always the plan's real
 * price, and this sentence carries the whole story of what happened to it.
 *
 * Run: npm run test:billing-note
 */
import { billingNote } from "../lib/notifications";

const FEE = 300_000; // 3,000 naira
const ENDS = new Date("2026-10-19T12:00:00Z");

const cases: Array<[string, Parameters<typeof billingNote>[0], string]> = [
  [
    "free plan",
    { planFeeKobo: 0, discountKobo: 0, discountEndsAt: null, couponCode: null },
    "This plan has no monthly fee.",
  ],
  [
    "paid, no discount",
    { planFeeKobo: FEE, discountKobo: 0, discountEndsAt: null, couponCode: null },
    "₦3,000.00 a month, charged monthly.",
  ],
  [
    "100% code with a window",
    { planFeeKobo: FEE, discountKobo: FEE, discountEndsAt: ENDS, couponCode: "LAUNCH20" },
    "Free until 19 October 2026 with code LAUNCH20. ₦3,000.00 a month after that.",
  ],
  [
    "trial, no code",
    { planFeeKobo: FEE, discountKobo: FEE, discountEndsAt: ENDS, couponCode: null },
    "Free until 19 October 2026. ₦3,000.00 a month after that.",
  ],
  [
    "partial code",
    { planFeeKobo: FEE, discountKobo: 60_000, discountEndsAt: ENDS, couponCode: "SAVE20" },
    "₦600.00 off your first payment with code SAVE20. ₦3,000.00 a month from 19 October 2026.",
  ],
  [
    "full waiver, no end date",
    { planFeeKobo: FEE, discountKobo: FEE, discountEndsAt: null, couponCode: null },
    "Waived. Normally ₦3,000.00 a month.",
  ],
];

let failed = 0;
for (const [name, input, want] of cases) {
  const got = billingNote(input);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(24)} ${got}`);
  if (!ok) console.log(`      wanted: ${want}`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
