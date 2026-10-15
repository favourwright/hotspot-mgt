/**
 * The voucher-sale split, exercised without Paystack.
 *
 * This decides how a customer's payment is divided between the tenant and
 * the platform, so it is the highest-stakes arithmetic in the app. Both
 * checkout paths go through it.
 *
 * The cases that matter are about the fee bearer. Passthrough adds
 * Paystack's estimated fee to what the customer pays; who that reimburses
 * depends on who Paystack will take its real fee from. Routing it to the
 * platform while the tenant's subaccount also absorbs it charges for the
 * same fee twice - and on a comped plan, where the platform's commission is
 * zero, the entire charge would be that double.
 *
 * Run: npm run test:split
 */
import { computeCheckoutSplit } from "../lib/paystack-fees";

const PRICE = 100_000; // 1,000 naira
const FEE = 1_500; // 15 naira, as passthrough would estimate

type Case = [
  string,
  Parameters<typeof computeCheckoutSplit>[0],
  { amount: number; transactionCharge: number | null },
];

const cases: Case[] = [
  // Passthrough off: no fee anywhere, so the split falls back to the
  // subaccount's stored percentage exactly as it always has.
  [
    "no fee, commission 10%",
    { priceKobo: PRICE, feeKobo: 0, platformFeePercent: 10, bearer: "account", hasSubaccount: true },
    // Null, not the commission. With no fee there is nothing to override
    // for, and sending one would make the Firestore field authoritative
    // over the subaccount's stored percentage - which drifts from it by
    // design, so that would move money for any tenant whose plan was
    // edited after signup.
    { amount: PRICE, transactionCharge: null },
  ],
  [
    "no fee, comped tenant",
    { priceKobo: PRICE, feeKobo: 0, platformFeePercent: 0, bearer: "subaccount", hasSubaccount: true },
    { amount: PRICE, transactionCharge: null },
  ],

  // Passthrough on, platform bears Paystack's fee: it collects the fee the
  // customer paid, which offsets what Paystack is about to deduct from it.
  [
    "fee, bearer account, commission 10%",
    { priceKobo: PRICE, feeKobo: FEE, platformFeePercent: 10, bearer: "account", hasSubaccount: true },
    { amount: PRICE + FEE, transactionCharge: 10_000 + FEE },
  ],

  // Passthrough on, tenant bears it: the fee must NOT also go to the
  // platform. This is the case the shared helper exists for.
  [
    "fee, bearer subaccount, commission 10%",
    { priceKobo: PRICE, feeKobo: FEE, platformFeePercent: 10, bearer: "subaccount", hasSubaccount: true },
    { amount: PRICE + FEE, transactionCharge: 10_000 },
  ],
  [
    "fee, bearer subaccount, comped tenant",
    { priceKobo: PRICE, feeKobo: FEE, platformFeePercent: 0, bearer: "subaccount", hasSubaccount: true },
    { amount: PRICE + FEE, transactionCharge: null },
  ],
  [
    "fee, bearer account, comped tenant",
    { priceKobo: PRICE, feeKobo: FEE, platformFeePercent: 0, bearer: "account", hasSubaccount: true },
    { amount: PRICE + FEE, transactionCharge: FEE },
  ],

  // No subaccount: nothing to split. The whole charge settles into the
  // platform's own account, which is a different problem and not this
  // function's to solve.
  [
    "no subaccount",
    { priceKobo: PRICE, feeKobo: FEE, platformFeePercent: 10, bearer: "account", hasSubaccount: false },
    { amount: PRICE + FEE, transactionCharge: null },
  ],
];

let failed = 0;
for (const [name, input, want] of cases) {
  const got = computeCheckoutSplit(input);
  const ok =
    got.amount === want.amount &&
    got.transactionCharge === want.transactionCharge;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} amount=${got.amount} charge=${String(got.transactionCharge)}` +
      (ok ? "" : `  (wanted amount=${want.amount} charge=${String(want.transactionCharge)})`)
  );
}

if (failed > 0) {
  console.error(`\n${failed} of ${cases.length} failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
