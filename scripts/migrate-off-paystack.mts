/**
 * One-off: moves the stored data off Paystack's names, for phase 3c (docs/billing-and-payments.md).
 *
 *   npm run migrate:off-paystack            # dry run: counts what would change, writes nothing
 *   npm run migrate:off-paystack -- --apply # writes it
 *
 * Safe to run again: a document already moved is left alone. What it does:
 *
 *  - payments and vouchers (every tenant): `paystackReference` becomes `reference`;
 *    payments' `subaccountCode` becomes `payeeReference`.
 *  - platform/config: `paystackFeePassthrough` becomes `processingFeePassthrough`, and
 *    `paystackBearer` becomes `feeBearer` ("account" -> "platform", "subaccount" -> "tenant").
 *  - billing plans: `paystackBearer` becomes `feeBearer` the same way; the cached Paystack
 *    Plan codes are dropped.
 *  - tenants: `paymentGateway` (everyone is on Knomad Pay now), `paystackSubaccountCode`
 *    and the Paystack subscription fields are dropped. Their payees are made separately
 *    (scripts/knomad-pay-payees.mts, or the reconcile cron).
 *  - entitlements: the Paystack subscription fields are dropped.
 *  - addons: the cached Paystack Plan codes are dropped.
 *
 * Prints counts only, never a document's contents.
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { FieldValue } = await import("firebase-admin/firestore");

const apply = process.argv.includes("--apply");
const del = FieldValue.delete();
const BEARER: Record<string, string> = { account: "platform", subaccount: "tenant" };

type Change = { ref: FirebaseFirestore.DocumentReference; update: Record<string, unknown> };
const changes = new Map<string, Change[]>();
const add = (group: string, ref: FirebaseFirestore.DocumentReference, update: Record<string, unknown>) => {
  if (Object.keys(update).length === 0) return;
  if (!changes.has(group)) changes.set(group, []);
  changes.get(group)!.push({ ref, update });
};
const has = (data: FirebaseFirestore.DocumentData, key: string) => Object.prototype.hasOwnProperty.call(data, key);

// Payments and vouchers.
for (const group of ["payments", "vouchers"]) {
  for (const doc of (await adminDb.collectionGroup(group).get()).docs) {
    const d = doc.data();
    const u: Record<string, unknown> = {};
    if (has(d, "paystackReference")) {
      if (!has(d, "reference")) u.reference = d.paystackReference;
      u.paystackReference = del;
    }
    if (group === "payments" && has(d, "subaccountCode")) {
      if (!has(d, "payeeReference")) u.payeeReference = d.subaccountCode;
      u.subaccountCode = del;
    }
    add(group, doc.ref, u);
  }
}

// Platform config.
const configRef = adminDb.collection("platform").doc("config");
const config = (await configRef.get()).data();
if (config) {
  const u: Record<string, unknown> = {};
  if (has(config, "paystackFeePassthrough")) {
    if (!has(config, "processingFeePassthrough")) u.processingFeePassthrough = config.paystackFeePassthrough;
    u.paystackFeePassthrough = del;
  }
  if (has(config, "paystackBearer")) {
    if (!has(config, "feeBearer")) u.feeBearer = BEARER[config.paystackBearer] ?? "platform";
    u.paystackBearer = del;
  }
  add("platform config", configRef, u);
}

// Billing plans.
for (const doc of (await adminDb.collection("billingPlans").get()).docs) {
  const d = doc.data();
  const u: Record<string, unknown> = {};
  if (has(d, "paystackBearer")) {
    if (!has(d, "feeBearer")) u.feeBearer = d.paystackBearer === null ? null : (BEARER[d.paystackBearer] ?? null);
    u.paystackBearer = del;
  }
  for (const k of ["paystackPlanCode", "paystackPlanAmount", "paystackPlanCodeWithFee", "paystackPlanAmountWithFee"]) if (has(d, k)) u[k] = del;
  add("billing plans", doc.ref, u);
}

// Tenants.
const TENANT_DROP = ["paymentGateway", "paystackSubaccountCode", "paystackCustomerCode", "paystackSubscriptionCode", "subscriptionStatus", "supersededSubscriptionCode"];
for (const doc of (await adminDb.collection("tenants").get()).docs) {
  const d = doc.data();
  const u: Record<string, unknown> = {};
  for (const k of TENANT_DROP) if (has(d, k)) u[k] = del;
  add("tenants", doc.ref, u);
}

// Entitlements and addons.
for (const doc of (await adminDb.collectionGroup("entitlements").get()).docs) {
  const d = doc.data();
  const u: Record<string, unknown> = {};
  for (const k of ["paystackSubscriptionCode", "paystackCustomerCode"]) if (has(d, k)) u[k] = del;
  add("entitlements", doc.ref, u);
}
for (const doc of (await adminDb.collection("addons").get()).docs) {
  const d = doc.data();
  const u: Record<string, unknown> = {};
  for (const k of ["paystackPlanCode", "paystackPlanAmount"]) if (has(d, k)) u[k] = del;
  add("addons", doc.ref, u);
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: documents to change`);
let total = 0;
for (const [group, list] of changes) {
  console.log(`  ${group.padEnd(16)} ${list.length}`);
  total += list.length;
}
if (total === 0) {
  console.log("Nothing to change: already moved.");
  process.exit(0);
}
if (!apply) {
  console.log("Dry run: nothing was written. Run again with --apply.");
  process.exit(0);
}

// Batches of at most 400 writes.
const all = [...changes.values()].flat();
for (let i = 0; i < all.length; i += 400) {
  const batch = adminDb.batch();
  for (const { ref, update } of all.slice(i, i + 400)) batch.update(ref, update);
  await batch.commit();
}
console.log(`Wrote ${all.length} documents.`);
