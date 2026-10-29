/**
 * Server-side checkout: which charges are honoured, and on whose say-so.
 *
 * Each case here is a way money could move wrongly and look fine. A
 * charge with no checkout record treated as legacy forever means
 * enforcement never starts. Deciding "legacy" from the millis inside the
 * reference means a backdated reference walks through, because the browser
 * used to choose it. An amount checked against today's plan price instead
 * of the agreed one refuses a customer who paid exactly what they were
 * quoted.
 *
 * Run: npm run test:purchase-initiate
 */
import {
  chargeAuthority,
  newPurchaseReference,
  pendingMismatch,
} from "../lib/charge-authority";
import { rateLimit, resetRateLimits } from "../lib/rate-limit";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = String(got) === String(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${String(got)}`);
  if (!ok) console.log(`      wanted: ${String(want)}`);
}

const CUTOVER = new Date("2026-10-30T09:00:00.000Z");
const BEFORE = "2026-10-30T08:59:59.000Z";
const AFTER = "2026-10-30T09:00:01.000Z";

/* ------------------------------------------------ who decides the sale */

check("a checkout record always decides, before cutover",
  chargeAuthority({ hasPendingRecord: true, paidAt: BEFORE, cutoverAt: CUTOVER }), "pending");
check("a checkout record always decides, after cutover",
  chargeAuthority({ hasPendingRecord: true, paidAt: AFTER, cutoverAt: CUTOVER }), "pending");
check("a checkout record decides even with enforcement off",
  chargeAuthority({ hasPendingRecord: true, paidAt: AFTER, cutoverAt: null }), "pending");

check("no record, enforcement off: honoured as before",
  chargeAuthority({ hasPendingRecord: false, paidAt: AFTER, cutoverAt: null }), "legacy");
check("no record, paid before cutover: honoured (old tab)",
  chargeAuthority({ hasPendingRecord: false, paidAt: BEFORE, cutoverAt: CUTOVER }), "legacy");
check("no record, paid after cutover: review",
  chargeAuthority({ hasPendingRecord: false, paidAt: AFTER, cutoverAt: CUTOVER }), "unauthorised");
check("no record, paid at the cutover instant: review",
  chargeAuthority({ hasPendingRecord: false, paidAt: CUTOVER.toISOString(), cutoverAt: CUTOVER }), "unauthorised");
check("no record, no paid time, enforcement on: review, never assume old",
  chargeAuthority({ hasPendingRecord: false, paidAt: null, cutoverAt: CUTOVER }), "unauthorised");
check("no record, garbage paid time, enforcement on: review",
  chargeAuthority({ hasPendingRecord: false, paidAt: "not a date", cutoverAt: CUTOVER }), "unauthorised");
check("accepts a Date for paid time",
  chargeAuthority({ hasPendingRecord: false, paidAt: new Date(BEFORE), cutoverAt: CUTOVER }), "legacy");

// The reference is not consulted at all. A backdated one (millis from a
// year ago, chosen by a browser) changes nothing: only Paystack's paid time
// counts. This is a property of the signature, asserted so nobody "helps"
// by adding the reference later.
check("decision takes no reference argument",
  chargeAuthority.length, 1);

/* ------------------------------------------------ does it match */

const pending = { amountKobo: 50750, currency: "NGN" };

check("exact match is no mismatch",
  pendingMismatch(pending, { amount: 50750, currency: "NGN" }), null);
check("one kobo short is an amount mismatch",
  pendingMismatch(pending, { amount: 50749, currency: "NGN" })?.kind, "amount_mismatch");
check("overpaid is still a mismatch, not a bonus",
  pendingMismatch(pending, { amount: 60000, currency: "NGN" })?.kind, "amount_mismatch");
check("wrong currency is reported as currency, not amount",
  pendingMismatch(pending, { amount: 50750, currency: "USD" })?.kind, "currency_mismatch");
check("wrong currency and amount: currency first",
  pendingMismatch(pending, { amount: 1, currency: "GHS" })?.kind, "currency_mismatch");

/* ------------------------------------------------ references */

const ref = newPurchaseReference(1761818400000, "0123456789abcdef");
check("reference keeps the hs_<millis>_<suffix> shape", ref, "hs_1761818400000_0123456789abcdef");
// lib/transactions.ts splits payment ids on the FIRST underscore; a suffix
// containing one would break paging on the transactions page.
check("splitting on the first underscore recovers the millis",
  Number(ref.slice(3).split("_")[0]), 1761818400000);
check("suffix has no underscore", ref.split("_").length, 3);
check("matches the pending-record lookup pattern",
  /^hs_\d+_[0-9a-f]{16}$/.test(ref), true);

let threw = false;
try {
  newPurchaseReference(1, "XYZ_not_hex_____");
} catch {
  threw = true;
}
check("refuses a non-hex suffix", threw, true);

/* ------------------------------------------------ rate limit */

resetRateLimits();
const LIMIT = { max: 3, windowMs: 60_000 };
const t0 = 1_000_000;
check("1st within limit", rateLimit("u1", LIMIT, t0).ok, true);
check("2nd within limit", rateLimit("u1", LIMIT, t0 + 1).ok, true);
check("3rd within limit", rateLimit("u1", LIMIT, t0 + 2).ok, true);
const blocked = rateLimit("u1", LIMIT, t0 + 3);
check("4th refused", blocked.ok, false);
check("retry-after points at the oldest hit leaving the window", blocked.retryAfterMs, 60_000 - 3);
check("another buyer is unaffected", rateLimit("u2", LIMIT, t0 + 3).ok, true);
check("allowed again once the window slides",
  rateLimit("u1", LIMIT, t0 + 60_001).ok, true);

// Bounded: flooding with keys must not grow memory without limit. The
// oldest key is dropped, so it starts fresh.
resetRateLimits();
rateLimit("first", { max: 1, windowMs: 60_000 }, t0);
for (let i = 0; i < 10_000; i += 1) rateLimit(`k${i}`, LIMIT, t0);
check("oldest key evicted under a flood, so it is allowed again",
  rateLimit("first", { max: 1, windowMs: 60_000 }, t0).ok, true);

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
