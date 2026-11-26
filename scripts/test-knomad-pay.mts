/**
 * Voucher sales through Knomad Pay, exercised without the network.
 *
 * Three things decide whether a tenant is paid right: the processing fee passed on, the
 * split sent to Knomad Pay, and how its answer is read back by fulfilment. The split
 * must give the platform its commission (plus the passed-on fee when it bears the fee)
 * and the tenant the rest, for every setting. And the read-back must make fulfilment's
 * expected-share check agree, or every sale raises a split-mismatch warning (as the
 * first comped tenant's once did).
 *
 * Run: npm run test:knomad-pay
 */
import type { Charge } from "@favourwright/knomad-pay-client";
import { knomadPaySplit, toVerifiedCharge } from "../lib/knomad-pay";
import { estimateProcessingFee, saleShares } from "../lib/processing-fees";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
}

const PRICE = 100_000; // 1,000 naira
const PAYEE = "tenant_t1";

// 0. The processing fee passed on: off is nothing; on, the formula with its waiver and cap.
const ON = { enabled: true, percent: 1.5, flatFeeKobo: 10_000, capKobo: 200_000, waiveFlatFeeBelowKobo: 250_000 };
check("passthrough off adds nothing", estimateProcessingFee(PRICE, { ...ON, enabled: false }) === 0);
check("small amount: percentage only", estimateProcessingFee(PRICE, ON) === 1_500);
check("above the waiver: percentage plus the flat fee", estimateProcessingFee(500_000, ON) === 7_500 + 10_000);
check("capped", estimateProcessingFee(50_000_000, ON) === 200_000);
check("nothing on nothing", estimateProcessingFee(0, ON) === 0);

// 1. The platform keeps its commission, plus the passed-on fee when it bears the fee.
for (const feeKobo of [0, 1_500]) {
  for (const bearer of ["platform", "tenant"] as const) {
    for (const platformFeePercent of [0, 10, 33]) {
      const amount = PRICE + feeKobo;
      const commission = Math.round((PRICE * platformFeePercent) / 100);
      const wantPlatform = commission + (bearer === "platform" ? feeKobo : 0);
      const ours = knomadPaySplit({ amountKobo: amount, priceKobo: PRICE, feeKobo, platformFeePercent, bearer, payeeReference: PAYEE });
      const label = `fee ${feeKobo}, ${bearer} bears, ${platformFeePercent}%`;
      check(`platform share is commission + fee it bears (${label})`, ours?.platformShareKobo === wantPlatform, `got ${ours?.platformShareKobo}, want ${wantPlatform}`);
      check(`tenant + platform = what the buyer pays (${label})`, ours !== null && ours.tenantShareKobo + ours.platformShareKobo === amount);
      const payee = ours?.split.payees[0];
      check(
        `flat tenant share, fee on the right side (${label})`,
        payee !== undefined && "amountKobo" in payee.share && payee.share.amountKobo === ours!.tenantShareKobo &&
          ours!.split.feeBearer === (bearer === "tenant" ? PAYEE : "platform"),
      );
    }
  }
}

// 2. No split where there is nothing to send a tenant.
check("no payee, no split", knomadPaySplit({ amountKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 10, bearer: "platform", payeeReference: null }) === null);
check("a 100% commission leaves the tenant nothing: no split", knomadPaySplit({ amountKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 100, bearer: "platform", payeeReference: PAYEE }) === null);

// 3. Reading Knomad Pay's answer back.
function charge(overrides: Partial<Charge> = {}): Charge {
  return {
    reference: "hs_1795612538735_0123456789abcdef",
    status: "succeeded",
    statusReason: null,
    amountKobo: PRICE,
    currency: "NGN",
    amountPaidKobo: PRICE,
    checkoutUrl: "https://sdk.monnify.com/checkout/MNFY|1",
    customer: { email: "buyer@example.com", name: null },
    description: "Daily wifi voucher",
    metadata: { planId: "p1", locationId: "l1", tenantId: "t1", userId: "u1", intent: "new" },
    split: { payees: [{ payee: PAYEE, amountKobo: 90_000, bearsFee: false }], platformKobo: 10_000 },
    paidAt: "2026-11-25T12:00:00.000Z",
    paymentMethod: "CARD",
    version: 3,
    createdAt: "2026-11-25T11:59:00.000Z",
    updatedAt: "2026-11-25T12:00:00.000Z",
    ...overrides,
  };
}

const read = toVerifiedCharge(charge());
check("succeeded reads as success", read.success === true && read.data?.status === "success");
check("amount, currency, buyer and metadata carried", read.data?.amount === PRICE && read.data.currency === "NGN" && read.data.customerEmail === "buyer@example.com" && read.data.metadata?.userId === "u1");
check("the split reads as the payee and both shares", read.data?.split?.payeeReference === PAYEE && read.data.split.tenantShareKobo === 90_000 && read.data.split.platformShareKobo === 10_000);
for (const status of ["pending", "initiating", "failed", "expired", "partially_paid", "needs_review"] as const) {
  check(`${status} is not a success`, toVerifiedCharge(charge({ status })).success === false);
}
check("no split, no split figures", toVerifiedCharge(charge({ split: null })).data?.split === undefined);

// 4. Fulfilment's expected-share check (`saleShares`) agrees with what Knomad Pay reports.
for (const feeKobo of [0, 1_500]) {
  for (const bearer of ["platform", "tenant"] as const) {
    const amount = PRICE + feeKobo;
    const division = knomadPaySplit({ amountKobo: amount, priceKobo: PRICE, feeKobo, platformFeePercent: 10, bearer, payeeReference: PAYEE })!;
    const reported = toVerifiedCharge(charge({ amountKobo: amount, split: { payees: [{ payee: PAYEE, amountKobo: division.tenantShareKobo, bearsFee: bearer === "tenant" }], platformKobo: division.platformShareKobo } }));
    const expected = saleShares({ amountKobo: amount, priceKobo: PRICE, feeKobo, platformFeePercent: 10, bearer }).tenantShareKobo;
    check(`fulfilment expects what Knomad Pay reports (fee ${feeKobo}, ${bearer} bears)`, expected === reported.data!.split!.tenantShareKobo, `expected ${expected}, reported ${reported.data!.split!.tenantShareKobo}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
