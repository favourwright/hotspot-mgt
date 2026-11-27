/**
 * Records money given back to a tenant, on the platform revenue ledger.
 *
 * The ledger is never edited (docs/platform-revenue.md): a refund is a new
 * entry with a negative amount, for the same tenant and source, pointing at
 * the entry it refunds. This writes that entry and nothing else. Giving the
 * money back (in Knomad Pay or by transfer) and undoing what it bought (taking
 * credits back in the tenant's billing dialog, ending an addon) are separate
 * steps, done where they are normally done.
 *
 * A dry run unless given --apply. It reads the earlier refunds of the entry
 * and writes the new one in one transaction, so two runs at once cannot
 * refund the same money twice, and never more than the entry was for.
 *
 *   npm run revenue:refund -- --entry bill_123 --naira 5000 --reason "Charged twice"
 *   npm run revenue:refund -- --entry bill_123 --naira 5000 --reason "Charged twice" --apply
 *
 * `--entry` is a ledger entry id: a billing charge reference, `sale_<payment
 * reference>`, or `credit_<ledger entry>`; `npm run revenue:reconcile` lists
 * them. Uses .env.production, so it writes to the live project.
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { refundRevenue, revenueEntryId } = await import("../lib/platform-revenue");

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const apply = process.argv.includes("--apply");
const entryId = arg("entry");
const naira = Number(arg("naira"));
const reason = arg("reason") ?? "";
if (!entryId || !Number.isFinite(naira) || naira <= 0) {
  console.error('Usage: npm run revenue:refund -- --entry <id> --naira <amount> --reason "<why>" [--apply]');
  process.exit(1);
}
const amountKobo = Math.round(naira * 100);

const ledger = adminDb.collection(COLLECTIONS.PLATFORM_REVENUE);

try {
  const written = await adminDb.runTransaction(async (tx) => {
    const original = await tx.get(ledger.doc(entryId));
    if (!original.exists) throw new Error(`No ledger entry ${entryId}.`);
    const o = original.data()!;
    const earlier = await tx.get(ledger.where("reference", "==", entryId).where("kind", "==", "refund"));
    const alreadyRefundedKobo = earlier.docs.reduce((sum, d) => sum + -Number(d.get("amountKobo") ?? 0), 0);

    console.log(`  entry    ${entryId}: ${o.source}/${o.kind}, tenant ${o.tenantId}, ${o.amountKobo} kobo`);
    console.log(`  refunded ${alreadyRefundedKobo} kobo before, in ${earlier.size} refund(s)`);

    const made = refundRevenue({
      originalId: entryId,
      original: { source: o.source, tenantId: o.tenantId, amountKobo: Number(o.amountKobo) },
      alreadyRefundedKobo,
      amountKobo,
      reason,
      at: new Date(),
    });
    if (!made.ok) throw new Error(made.error);

    const id = revenueEntryId("refund", `${entryId}_${earlier.size + 1}`);
    console.log(`  ${apply ? "writing" : "would write"} ${id}: ${made.entry.amountKobo} kobo, "${made.entry.note}"`);
    if (apply) tx.create(ledger.doc(id), made.entry);
    return apply;
  });
  if (!written) console.log("\nDry run. Nothing changed. Add --apply to write.");
  else console.log("\nWritten. The billing page shows it within a minute.");
  process.exit(0);
} catch (error) {
  console.error(`\nNothing written: ${(error as Error).message}`);
  process.exit(1);
}
