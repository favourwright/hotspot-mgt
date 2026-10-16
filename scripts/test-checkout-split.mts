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
import {
  computeCheckoutSplit,
  expectedTenantShareKobo,
} from "../lib/paystack-fees";

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

/**
 * What the tenant's subaccount should receive back, which is what the
 * split-mismatch alert compares against.
 *
 * The first case is the one that fired a false alarm on every single sale: a
 * comped tenant whose subaccount bears Paystack's fee receives the charge
 * minus that fee, and the old expectation - price minus the platform's
 * percentage, with no fee term at all - said they should receive all of it.
 */
const PAYSTACK_FEE = 750; // 1.5% of 500 naira, as Paystack reported it

const shares: Array<
  [string, Parameters<typeof expectedTenantShareKobo>[0], number]
> = [
  [
    "comped tenant bears the fee",
    {
      chargedKobo: 50_000,
      priceKobo: 50_000,
      feeKobo: 0,
      platformFeePercent: 0,
      bearer: "subaccount",
      paystackFeeKobo: PAYSTACK_FEE,
    },
    49_250,
  ],
  [
    "commission 10%, platform bears the fee",
    {
      chargedKobo: 50_000,
      priceKobo: 50_000,
      feeKobo: 0,
      platformFeePercent: 10,
      bearer: "account",
      paystackFeeKobo: PAYSTACK_FEE,
    },
    45_000,
  ],
  [
    "commission 10%, tenant bears the fee",
    {
      chargedKobo: 50_000,
      priceKobo: 50_000,
      feeKobo: 0,
      platformFeePercent: 10,
      bearer: "subaccount",
      paystackFeeKobo: PAYSTACK_FEE,
    },
    44_250,
  ],
  [
    // Paystack reported no fee. Treated as zero rather than guessed, so the
    // expectation stays the plain split and any real discrepancy still
    // surfaces.
    "no fee reported",
    {
      chargedKobo: 50_000,
      priceKobo: 50_000,
      feeKobo: 0,
      platformFeePercent: 0,
      bearer: "subaccount",
      paystackFeeKobo: null,
    },
    50_000,
  ],
];

for (const [name, input, want] of shares) {
  const got = expectedTenantShareKobo(input);
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} expected share=${got}` +
      (ok ? "" : `  (wanted ${want})`)
  );
}

const total = cases.length + shares.length;
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
