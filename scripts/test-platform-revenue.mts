/**
 * What each payment puts on the platform revenue ledger.
 *
 * The two mistakes these catch are the ones that would make the billing page
 * quietly wrong: counting the passed-on processing fee as the platform's
 * money, and giving two payments one entry id (or one payment two).
 *
 * Run: npm run test:platform-revenue
 */
import { chargeRevenue, creditGrantRevenue, revenueEntryId } from "../lib/platform-revenue";

let failed = 0;
let total = 0;

function check(name: string, got: unknown, want: unknown) {
  total += 1;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${JSON.stringify(got)}`);
  if (!ok) console.log(`      wanted: ${JSON.stringify(want)}`);
}

const paidAt = new Date("2026-11-26T10:00:00Z");
const base = { reference: "bill_1", tenantId: "t1", addonKey: null, priceKobo: 500000, feeKobo: 7500, paidAt };

const plan = chargeRevenue({ ...base, kind: "plan" });
check("plan: source", plan.source, "plan");
check("plan: the price is revenue, not price plus fee", plan.amountKobo, 500000);
check("plan: the fee is kept apart", plan.feeKobo, 7500);
check("plan: dated when paid", plan.occurredAt.toISOString(), paidAt.toISOString());
check("plan: through the gateway", plan.method, "knomadpay");

const signup = chargeRevenue({ ...base, kind: "signup" });
check("signup: counted as a plan payment", signup.source, "plan");
check("signup: still told apart by kind", signup.kind, "signup");

const addon = chargeRevenue({ ...base, kind: "addon", addonKey: "voucher-generation" });
check("addon: source", addon.source, "addon");
check("addon: kind is the addon key", addon.kind, "voucher-generation");

const grant = creditGrantRevenue({ ledgerEntryId: "L1", tenantId: "t1", amountReceivedKobo: 300000, at: paidAt });
check("credit grant: source", grant.source, "credits");
check("credit grant: amount paid", grant.amountKobo, 300000);
check("credit grant: no gateway fee", grant.feeKobo, 0);
check("credit grant: recorded by hand", grant.method, "manual");

check("ids: a charge is its reference", revenueEntryId("charge", "bill_1"), "bill_1");
check("ids: a grant cannot collide with a charge", revenueEntryId("credit-grant", "bill_1") !== "bill_1", true);
check("ids: stable, so a re-run writes the same entry", revenueEntryId("credit-grant", "L1"), revenueEntryId("credit-grant", "L1"));

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
