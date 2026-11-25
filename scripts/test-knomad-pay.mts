/**
 * Voucher sales through Knomad Pay, exercised without the network.
 *
 * Two things decide whether a tenant is paid right: the split sent to Knomad Pay, and
 * how its answer is read back by fulfilment. The split must give the platform exactly
 * what Paystack's transaction_charge would have, for every fee setting and bearer, or
 * moving a tenant moves money. And the read-back must make fulfilment's own
 * expected-share check agree, or every sale raises a split-mismatch warning (as the
 * first comped tenant's did on Paystack).
 *
 * Run: npm run test:knomad-pay
 */
import type { Charge } from "@favourwright/knomad-pay-client";
import { knomadPaySplit, toVerifiedCharge } from "../lib/knomad-pay";
import { computeCheckoutSplit, expectedTenantShareKobo } from "../lib/paystack-fees";

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
}

const PRICE = 100_000; // 1,000 naira
const PAYEE = "tenant_t1";

// 1. The platform keeps what Paystack's transaction_charge would have given it.
for (const feeKobo of [0, 1_500]) {
  for (const bearer of ["account", "subaccount"] as const) {
    for (const platformFeePercent of [0, 10, 33]) {
      const amount = PRICE + feeKobo;
      const paystack = computeCheckoutSplit({ priceKobo: PRICE, feeKobo, platformFeePercent, bearer, hasSubaccount: true });
      // With no per-charge override, Paystack applied the stored percentage: the commission.
      const paystackPlatform = paystack.transactionCharge ?? Math.round((PRICE * platformFeePercent) / 100);
      const ours = knomadPaySplit({ amountKobo: amount, priceKobo: PRICE, feeKobo, platformFeePercent, bearer, payeeReference: PAYEE });
      const label = `fee ${feeKobo}, ${bearer} bears, ${platformFeePercent}%`;
      check(`platform share matches Paystack (${label})`, ours?.platformShareKobo === paystackPlatform, `got ${ours?.platformShareKobo}, Paystack ${paystackPlatform}`);
      check(`tenant + platform = what the buyer pays (${label})`, ours !== null && ours.tenantShareKobo + ours.platformShareKobo === amount);
      const payee = ours?.split.payees[0];
      check(
        `flat tenant share, fee on the right side (${label})`,
        payee !== undefined && "amountKobo" in payee.share && payee.share.amountKobo === ours!.tenantShareKobo &&
          ours!.split.feeBearer === (bearer === "subaccount" ? PAYEE : "platform"),
      );
    }
  }
}

// 2. No split where there is nothing to send a tenant.
check("no payee, no split", knomadPaySplit({ amountKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 10, bearer: "account", payeeReference: null }) === null);
check("a 100% commission leaves the tenant nothing: no split", knomadPaySplit({ amountKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 100, bearer: "account", payeeReference: PAYEE }) === null);

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
check("the split reads as the tenant's subaccount figures", read.data?.subaccount?.subaccountCode === PAYEE && read.data.subaccount.tenantShareKobo === 90_000 && read.data.subaccount.platformShareKobo === 10_000 && read.data.subaccount.paystackFeeKobo === null);
for (const status of ["pending", "initiating", "failed", "expired", "partially_paid", "needs_review"] as const) {
  check(`${status} is not a success`, toVerifiedCharge(charge({ status })).success === false);
}
check("no split, no subaccount figures", toVerifiedCharge(charge({ split: null })).data?.subaccount === undefined);

// 4. Fulfilment's expected-share check agrees with what Knomad Pay reports (passthrough off).
for (const bearer of ["account", "subaccount"] as const) {
  const division = knomadPaySplit({ amountKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 10, bearer, payeeReference: PAYEE })!;
  const reported = toVerifiedCharge(charge({ split: { payees: [{ payee: PAYEE, amountKobo: division.tenantShareKobo, bearsFee: bearer === "subaccount" }], platformKobo: division.platformShareKobo } }));
  const expected = expectedTenantShareKobo({ chargedKobo: PRICE, priceKobo: PRICE, feeKobo: 0, platformFeePercent: 10, bearer, paystackFeeKobo: reported.data!.subaccount!.paystackFeeKobo });
  check(`fulfilment expects what Knomad Pay reports (${bearer} bears the fee)`, expected === reported.data!.subaccount!.tenantShareKobo, `expected ${expected}, reported ${reported.data!.subaccount!.tenantShareKobo}`);
}

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
