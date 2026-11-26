/**
 * Prices the generated codes that were made before batches recorded a price.
 *
 * Revenue counts a generated code as a cash sale at first use, at the price
 * its batch recorded (`plan.priceKobo`, copied onto the voucher as
 * `cashSaleKobo`). Batches generated before that shipped have no price, so
 * their codes count as sold for nothing. This fills both in from the plan's
 * price *now*, which is an estimate: a plan repriced since the batch was
 * generated gives today's price, not what the cards were sold for.
 *
 * It also gives each batch its stock totals (`unusedCount`,
 * `unusedValueKobo`), which every write of a batch's codes now keeps, so
 * the generate page's unused-codes figure is one `sum()`. Older batches
 * have none until this runs, and count as no stock.
 *
 * Walks batches, not vouchers: every voucher a batch activated is named in
 * its codes, so nothing here queries vouchers on `source`
 * (docs/decisions-and-gotchas.md) or needs an index.
 *
 * A dry run unless given --apply. A batch or voucher that already has a
 * price is left alone, so it is safe to repeat. Each write carries the
 * document's update time, so a batch the runner or the activation sweep is
 * writing at the same moment wins and is picked up by the next run.
 *
 * Uses .env.production, so this writes to the live project.
 *
 * Run: npm run generation:backfill-prices
 * Then: npm run generation:backfill-prices -- --apply
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");

const apply = process.argv.includes("--apply");
const batches = await adminDb.collectionGroup("voucherBatches").get();

let batchesPriced = 0;
let batchesStocked = 0;
let vouchersPriced = 0;
let noPlan = 0;
let failed = 0;

for (const doc of batches.docs) {
  const data = doc.data();
  const tenantPath = doc.ref.parent.parent!.path;
  let price: number | null = typeof data.plan?.priceKobo === "number" ? data.plan.priceKobo : null;

  const patch: Record<string, number> = {};
  if (price === null) {
    const plan = await adminDb.doc(`${tenantPath}/plans/${data.plan?.id}`).get();
    const current = plan.get("price");
    if (typeof current !== "number") {
      noPlan += 1;
      console.log(`  NO PLAN PRICE ${doc.ref.path} (plan ${data.plan?.id} is gone)`);
      continue;
    }
    price = current;
    patch["plan.priceKobo"] = price;
    console.log(`  ${apply ? "priced" : "would price"} ${doc.ref.path} at ${price} kobo`);
  }

  // The same arithmetic as codesWrite in lib/voucher-generation.ts.
  if (typeof data.unusedCount !== "number") {
    const unused = ((data.codes ?? []) as Array<{ status?: string }>).filter(
      (c) => c.status === "unused"
    ).length;
    patch.unusedCount = unused;
    patch.unusedValueKobo = unused * price;
    console.log(`  ${apply ? "stocked" : "would stock"} ${doc.ref.path}: ${unused} unused`);
  }

  if (Object.keys(patch).length > 0) {
    if (apply) {
      try {
        await doc.ref.update(patch, { lastUpdateTime: doc.updateTime });
      } catch (error) {
        failed += 1;
        console.log(`  CHANGED OR FAILED, rerun ${doc.ref.path}: ${(error as Error).name}`);
        continue;
      }
    }
    if ("plan.priceKobo" in patch) batchesPriced += 1;
    if ("unusedCount" in patch) batchesStocked += 1;
  }

  const voucherIds = ((data.codes ?? []) as Array<{ voucherId?: string | null }>)
    .map((c) => c.voucherId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  for (const id of voucherIds) {
    const voucher = await adminDb.doc(`${tenantPath}/vouchers/${id}`).get();
    if (!voucher.exists || typeof voucher.get("cashSaleKobo") === "number") continue;
    vouchersPriced += 1;
    console.log(`  ${apply ? "priced" : "would price"} ${voucher.ref.path}`);
    if (!apply) continue;
    try {
      await voucher.ref.update({ cashSaleKobo: price }, { lastUpdateTime: voucher.updateTime });
    } catch (error) {
      vouchersPriced -= 1;
      failed += 1;
      console.log(`  CHANGED OR FAILED, rerun ${voucher.ref.path}: ${(error as Error).name}`);
    }
  }
}

console.log(
  `\n${batches.size} batches, ${batchesPriced} ${apply ? "priced" : "to price"}, ` +
    `${batchesStocked} ${apply ? "stocked" : "to stock"}, ` +
    `${vouchersPriced} used codes ${apply ? "priced" : "to price"}, ` +
    `${noPlan} with no plan to price from, ${failed} failed.`
);
if (!apply) console.log("Dry run. Nothing changed. Add --apply to write.");
process.exit(failed === 0 ? 0 : 1);
