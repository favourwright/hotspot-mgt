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
import type { KnomadPayClient } from "@favourwright/knomad-pay-client";
import { knomadPaySplit, setKnomadPayClient, startKnomadPayCharge, toVerifiedCharge } from "../lib/knomad-pay";
import { estimateProcessingFee, saleShares } from "../lib/processing-fees";
import { worthAskingAgain } from "../lib/payment-standing";

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

// 3b. A charge that is not a success says how it stands, for the payment-return page.
const standingOf = (overrides: Partial<Charge>) => {
  const v = toVerifiedCharge(charge(overrides));
  return v.success ? null : v.standing;
};
const OPEN = "https://checkout.example/open";
for (const status of ["pending", "initiating"] as const) {
  const s = standingOf({ status, checkoutUrl: OPEN });
  check(`${status}: awaiting payment, with its checkout to go back to`, s?.state === "awaiting_payment" && s.checkoutUrl === OPEN);
}
for (const status of ["failed", "expired"] as const) {
  const s = standingOf({ status });
  check(`${status}: not paid, so trying again is a new charge`, s?.state === "not_paid" && s.reason === status);
}
for (const status of ["partially_paid", "needs_review"] as const) {
  check(`${status}: money moved, so never "try again"`, standingOf({ status })?.state === "received");
}
check("only awaiting payment and unknown are asked about again", worthAskingAgain({ state: "awaiting_payment", checkoutUrl: null }) && worthAskingAgain({ state: "unknown" }) && !worthAskingAgain({ state: "received" }) && !worthAskingAgain({ state: "not_paid", reason: "failed" }));

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

// 3. A start with no clear answer is sent again as the same request, never a new one.
{
  type Answer = { ok: true; data: Charge } | { ok: false; code: string } | "throw";
  const started = charge({ amountKobo: PRICE });
  const startWith = async (answers: Answer[], clock?: { now: () => number }) => {
    const sent: { reference: string; key: string }[] = [];
    const waits: number[] = [];
    setKnomadPayClient({
      createCharge: async (input: { reference: string }, write: { idempotencyKey: string }) => {
        sent.push({ reference: input.reference, key: write.idempotencyKey });
        const answer = answers.shift() ?? { ok: false, code: "OUTCOME_UNKNOWN" };
        if (answer === "throw") throw new Error("fetch failed");
        return answer.ok ? { ok: true, status: 201, data: answer.data, replayed: false } : { ok: false, status: 503, code: answer.code, message: answer.code };
      },
    } as unknown as KnomadPayClient);
    const result = await startKnomadPayCharge(
      { reference: "hs_r1", amountKobo: PRICE, currency: "NGN", customer: { email: "b@example.com" }, description: "x", callbackUrl: "https://example.com/cb", metadata: {} },
      { wait: async (ms) => void waits.push(ms), ...(clock ? { now: clock.now } : {}) }
    );
    setKnomadPayClient(null);
    return { result, sent, waits };
  };

  const quiet = console.warn;
  console.warn = () => {};
  try {
    const resumed = await startWith([{ ok: false, code: "OUTCOME_UNKNOWN" }, "throw", { ok: true, data: started }]);
    check("an unknown outcome, then no answer, then the charge: started", resumed.result.ok);
    check(
      "every try is the same reference under the same key",
      resumed.sent.length === 3 && resumed.sent.every((s) => s.reference === "hs_r1" && s.key === "charge:hs_r1"),
      JSON.stringify(resumed.sent)
    );
    check("it waits a second, then three, between tries", JSON.stringify(resumed.waits) === "[1000,3000]", JSON.stringify(resumed.waits));

    const outage = await startWith([]);
    check("gives up after three tries when the outcome stays unknown", !outage.result.ok && outage.sent.length === 3 && !outage.result.ok && outage.result.attempts === 3);

    const refused = await startWith([{ ok: false, code: "PROVIDER_REFUSED" }]);
    check("a clear refusal is not sent again", !refused.result.ok && refused.sent.length === 1 && refused.result.code === "PROVIDER_REFUSED");

    const invalid = await startWith([{ ok: false, code: "INVALID_SPLIT" }]);
    check("a request the gateway rejects is not sent again", !invalid.result.ok && invalid.sent.length === 1);

    let t = 0;
    const slow = await startWith([], { now: () => (t += 12_000) });
    check("stops when the next try would go past the budget", !slow.result.ok && slow.sent.length < 3, `sent ${slow.sent.length}`);
  } finally {
    console.warn = quiet;
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
