/**
 * A billing payment that cleared and cannot be applied is held for a person, as a voucher
 * sale's is: the record turns `held`, one `paymentReviews` document is written, and
 * nothing tries it again. A person can only refund it, and then nothing ever applies it.
 * Runs against the Firestore emulator, because the hold is a transaction.
 *
 *   npm run test:billing-review
 */
import { generateKeyPairSync } from "node:crypto";
import type { Charge, KnomadPayClient } from "@favourwright/knomad-pay-client";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set. Use `npm run test:billing-review`.");
  process.exit(1);
}

process.env.FIREBASE_ADMIN_PROJECT_ID = "demo-billing-review";
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "test@demo-billing-review.iam.gserviceaccount.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
// No email leaves a test.
delete process.env.MAILTRAP_API_TOKEN;
delete process.env.MAILTRAP_SENDER_EMAIL;

await fetch(
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-billing-review/databases/(default)/documents`,
  { method: "DELETE" }
);

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { setKnomadPayClient } = await import("../lib/knomad-pay");
const { confirmBillingCharge, prepareSignupClaim } = await import("../lib/billing-charges");
const { fulfilReviewedPayment, markReviewRefunded, listPaymentReviews, ReviewError } = await import("../lib/payment-reviews");

let failed = 0;
let total = 0;
function check(name: string, ok: boolean, detail = "") {
  total += 1;
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `: ${detail}`}`);
}

const PRICE = 500_000;
const OWNER = "owner@example.com";

// Knomad Pay, as each reference stands there.
const gateway = new Map<string, Partial<Charge>>();
let asked = 0;
setKnomadPayClient({
  getCharge: async (reference: string) => {
    asked += 1;
    const c = gateway.get(reference);
    if (!c) return { ok: false, status: 404, code: "NOT_FOUND", message: "no such charge" };
    const data: Charge = {
      reference,
      status: "succeeded",
      statusReason: null,
      amountKobo: PRICE,
      currency: "NGN",
      amountPaidKobo: PRICE,
      checkoutUrl: `https://checkout.example/${reference}`,
      customer: { email: OWNER, name: null },
      description: "billing",
      metadata: { purpose: "billing" },
      split: null,
      paidAt: "2026-11-28T10:00:00.000Z",
      paymentMethod: "CARD",
      version: 2,
      createdAt: "2026-11-28T09:59:00.000Z",
      updatedAt: "2026-11-28T10:00:00.000Z",
      ...c,
    };
    return { ok: true, status: 200, data };
  },
} as unknown as KnomadPayClient);

async function seed(reference: string, fields: Record<string, unknown>) {
  await adminDb.collection(COLLECTIONS.BILLING_CHARGES).doc(reference).set({
    reference,
    kind: "plan",
    tenantId: "t1",
    uid: "u1",
    email: OWNER,
    planId: "basic",
    addonKey: null,
    credits: null,
    priceKobo: PRICE,
    feeKobo: 0,
    amountKobo: PRICE,
    couponCode: null,
    status: "pending",
    periodFrom: null,
    periodTo: null,
    createdAt: new Date(),
    appliedAt: null,
    ...fields,
  });
}
const status = async (reference: string) =>
  (await adminDb.collection(COLLECTIONS.BILLING_CHARGES).doc(reference).get()).data()?.status;
const review = async (reference: string) =>
  (await adminDb.collection(COLLECTIONS.PAYMENT_REVIEWS).doc(reference).get()).data();

// 1. Each way a cleared payment can fail to apply is held, with its own kind.
const cases: { reference: string; fields: Record<string, unknown>; paid: Partial<Charge>; kind: string }[] = [
  { reference: "bill_amount", fields: {}, paid: { amountKobo: PRICE - 100 }, kind: "billing_amount_mismatch" },
  { reference: "bill_account", fields: { kind: "credits", credits: 50 }, paid: { customer: { email: "someone@else.com", name: null } }, kind: "billing_wrong_account" },
  { reference: "bill_credits", fields: { kind: "credits", credits: null }, paid: {}, kind: "billing_credits_missing" },
  { reference: "bill_addon", fields: { kind: "addon", addonKey: "gone" }, paid: {}, kind: "billing_addon_missing" },
];
for (const c of cases) {
  await seed(c.reference, c.fields);
  gateway.set(c.reference, c.paid);
  const result = await confirmBillingCharge(c.reference);
  const r = await review(c.reference);
  check(`${c.kind}: held`, result.state === "held", result.state);
  check(`${c.kind}: the record is held`, (await status(c.reference)) === "held");
  check(`${c.kind}: a billing review is written`, r?.purpose === "billing" && r.kind === c.kind && r.resolvedAt === null, JSON.stringify(r));
}

// 2. Held is final for every reporter: the gateway is not asked again, nor a second review written.
const before = asked;
const firstReview = await review("bill_amount");
const again = await confirmBillingCharge("bill_amount");
check("asked again: still held", again.state === "held");
check("asked again: the gateway is not asked", asked === before);
check(
  "asked again: the one review stands",
  (await review("bill_amount"))?.createdAt?.isEqual?.(firstReview?.createdAt) === true
);

// 3. The superadmin list shows them as billing.
const listed = await listPaymentReviews();
check("listed as billing reviews", listed.filter((r) => r.purpose === "billing").length === cases.length);

// 4. A billing review cannot be fulfilled anyway.
let refusedFulfil = false;
try {
  await fulfilReviewedPayment({ reference: "bill_account", note: null, resolvedBy: "admin" });
} catch (error) {
  refusedFulfil = error instanceof ReviewError && error.status === 400;
}
check("fulfil anyway is refused for billing", refusedFulfil);

// 5. Refunded, it is never applied: the record says so, and confirming refuses it.
await markReviewRefunded({ reference: "bill_amount", note: "refunded on Monnify", resolvedBy: "admin" });
check("refunded: the record is refunded", (await status("bill_amount")) === "refunded");
check("refunded: the review is resolved", (await review("bill_amount"))?.resolution === "refunded");
const afterRefund = await confirmBillingCharge("bill_amount");
check("refunded: confirming refuses it", afterRefund.state === "refused");

// 6. A held signup payment does not create a business, and says why.
await seed("bill_signup", { kind: "signup", tenantId: null });
gateway.set("bill_signup", { amountKobo: PRICE + 1 });
const claim = await prepareSignupClaim({ reference: "bill_signup", uid: "u1", planId: "basic", priceKobo: PRICE });
check("signup held: not claimed, 409", !claim.ok && claim.status === 409, JSON.stringify(claim));
check("signup held: reviewed", (await review("bill_signup"))?.kind === "billing_amount_mismatch");

// 7. Not paid yet is not a review: it says how it stands, with its checkout.
await seed("bill_open", {});
gateway.set("bill_open", { status: "pending", paidAt: null });
const open = await confirmBillingCharge("bill_open");
check(
  "pending: unpaid, awaiting payment with its checkout",
  open.state === "unpaid" && open.standing.state === "awaiting_payment" && open.standing.checkoutUrl === "https://checkout.example/bill_open",
  JSON.stringify(open)
);
check("pending: no review", (await review("bill_open")) === undefined);
check("pending: still pending", (await status("bill_open")) === "pending");

setKnomadPayClient(null);
if (failed > 0) {
  console.error(`\n${failed} of ${total} failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} cases passed.`);
process.exit(0);
