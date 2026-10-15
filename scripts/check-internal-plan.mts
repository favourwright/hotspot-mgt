/**
 * Does every company-owned-accounts plan still bundle every addon?
 *
 * This is the one real weakness of comping through a plan rather than
 * through a bypass in `lib/entitlements.ts`. Entitlements stay a single
 * auditable resolver, which is worth a lot - but the price is that adding an
 * addon to `lib/addon-catalog.ts` and forgetting to add its key to the
 * internal plan's `includedAddons` takes the feature away from the company's
 * own accounts, silently, the moment that addon stops being free.
 *
 * Reads live Firestore, because the drift this catches is in data, not code.
 * Run it after adding an addon, and before pricing one.
 *
 *   npm run check:internal-plan
 *
 * Exits non-zero only on a plan that is missing keys. Finding no internal
 * plans at all is reported and passes - a platform is allowed not to have
 * one.
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.development.local") });

const { getAllBillingPlans } = await import("../lib/billing-plans");
const { ADDON_KEYS } = await import("../lib/addon-catalog");

const plans = await getAllBillingPlans();
const internal = plans.filter((plan) => plan.internal);

console.log(`addon catalog: ${ADDON_KEYS.join(", ")}`);
console.log(`billing plans: ${plans.length}, marked internal: ${internal.length}\n`);

if (internal.length === 0) {
  console.log(
    "No plan is marked as a company-owned-accounts plan, so there is nothing\n" +
      "to check. Mark one in the billing plan dialog, under Advanced settings."
  );
  process.exit(0);
}

let failed = 0;

for (const plan of internal) {
  const missing = ADDON_KEYS.filter(
    (key) => !(plan.includedAddons ?? []).includes(key)
  );

  if (missing.length === 0) {
    console.log(`PASS  ${plan.name.padEnd(20)} bundles all ${ADDON_KEYS.length} addon(s)`);
    continue;
  }

  failed += 1;
  console.log(
    `FAIL  ${plan.name.padEnd(20)} missing: ${missing.join(", ")}`
  );
}

// Worth saying out loud rather than leaving someone to infer it from a plan
// that looks fine: these two are what actually make the comp a comp.
for (const plan of internal) {
  const notes: string[] = [];
  if (plan.monthlyFee !== 0) notes.push(`monthlyFee is ${plan.monthlyFee}`);
  if (plan.platformFeePercent !== 0)
    notes.push(`platformFeePercent is ${plan.platformFeePercent}`);
  if (plan.active) notes.push("selectable by new tenants at signup");
  if (notes.length > 0) {
    console.log(`\nnote  ${plan.name}: ${notes.join("; ")}`);
  }
}

if (failed > 0) {
  console.error(
    `\n${failed} internal plan(s) are missing addon keys. Tenants on them have` +
      `\nalready lost those features if the addon is priced. Add the keys in the` +
      `\nbilling plan dialog under Included Addons.`
  );
  process.exit(1);
}

console.log(`\nAll ${internal.length} internal plan(s) are complete.`);
