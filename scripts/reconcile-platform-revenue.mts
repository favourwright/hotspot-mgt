/**
 * Does the platform revenue ledger agree with the records of the money?
 *
 * Every applied billing charge and every credit grant with an amount paid
 * should have exactly one `platformRevenue` entry, for the same tenant and
 * amount. This lists:
 *
 *  - MISSING:  money recorded with no ledger entry. Before the ledger
 *              shipped, every payment; after, a writer somebody forgot.
 *  - DIFFERS:  an entry whose tenant or amount is not its source's. Never
 *              fixed here, because the ledger is never edited: look at it.
 *  - ORPHAN:   an entry with no source. Expected only for a refund or
 *              correction entered by hand.
 *
 * A dry run unless given --apply, which writes the missing entries and
 * nothing else. A backfilled entry is dated when the charge was applied
 * (or the grant made), the nearest the records keep to when it was paid.
 * Safe to repeat. Prints references and amounts, never a customer detail.
 *
 * Uses .env.production, so it reads, and with --apply writes, the live
 * project. Reads every charge, grant and entry: fine at today's volume, and
 * the place to add a date window when it is not.
 *
 * Run: npm run revenue:reconcile
 * Then: npm run revenue:reconcile -- --apply
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { chargeRevenue, creditGrantRevenue, revenueEntryId } = await import("../lib/platform-revenue");
type RevenueEntry = import("../lib/platform-revenue").RevenueEntry;

const apply = process.argv.includes("--apply");

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

// What the records of the money say the ledger should hold.
const expected = new Map<string, RevenueEntry>();

const charges = await adminDb.collection(COLLECTIONS.BILLING_CHARGES).where("status", "==", "applied").get();
for (const doc of charges.docs) {
  const c = doc.data();
  if (typeof c.tenantId !== "string") {
    console.log(`  SKIPPED ${doc.ref.path}: applied with no tenant`);
    continue;
  }
  expected.set(
    revenueEntryId("charge", c.reference),
    chargeRevenue({
      reference: c.reference,
      kind: c.kind,
      tenantId: c.tenantId,
      addonKey: c.addonKey ?? null,
      priceKobo: c.priceKobo,
      feeKobo: c.feeKobo ?? 0,
      paidAt: toDate(c.appliedAt) ?? toDate(c.createdAt) ?? new Date(0),
    })
  );
}

// The collection-group field index on amountReceivedKobo serves this.
const grants = await adminDb.collectionGroup("creditLedger").where("amountReceivedKobo", ">", 0).get();
for (const doc of grants.docs) {
  const g = doc.data();
  const tenantId = doc.ref.parent.parent!.id;
  expected.set(
    revenueEntryId("credit-grant", doc.id),
    creditGrantRevenue({
      ledgerEntryId: doc.id,
      tenantId,
      amountReceivedKobo: g.amountReceivedKobo,
      at: toDate(g.createdAt) ?? new Date(0),
    })
  );
}

const ledger = await adminDb.collection(COLLECTIONS.PLATFORM_REVENUE).get();
const held = new Map(ledger.docs.map((d) => [d.id, d.data()]));

let missing = 0;
let differs = 0;
let orphans = 0;
let written = 0;
let failed = 0;
const totals: Record<string, { expected: number; ledger: number }> = {};
const add = (source: string, side: "expected" | "ledger", kobo: number) => {
  totals[source] ??= { expected: 0, ledger: 0 };
  totals[source][side] += kobo;
};

for (const [id, entry] of expected) {
  add(entry.source, "expected", entry.amountKobo);
  const have = held.get(id);
  if (!have) {
    missing += 1;
    console.log(`  MISSING ${entry.source} ${id} ${entry.amountKobo} kobo`);
    if (!apply) continue;
    try {
      // `create`: if something wrote it since the read, that one stands.
      await adminDb.collection(COLLECTIONS.PLATFORM_REVENUE).doc(id).create(entry);
      written += 1;
    } catch (error) {
      failed += 1;
      console.log(`  NOT WRITTEN, rerun ${id}: ${(error as Error).name}`);
    }
    continue;
  }
  if (have.tenantId !== entry.tenantId || have.amountKobo !== entry.amountKobo) {
    differs += 1;
    console.log(
      `  DIFFERS ${id}: ledger ${have.tenantId}/${have.amountKobo}, source ${entry.tenantId}/${entry.amountKobo}`
    );
  }
}

for (const [id, have] of held) {
  add(String(have.source), "ledger", Number(have.amountKobo ?? 0));
  if (!expected.has(id)) {
    orphans += 1;
    console.log(`  ORPHAN ${have.source} ${id} ${have.amountKobo} kobo`);
  }
}

console.log("\nBy source, kobo (records of the money vs the ledger):");
for (const [source, t] of Object.entries(totals)) {
  console.log(`  ${source.padEnd(10)} ${String(t.expected).padStart(12)} ${String(t.ledger).padStart(12)}`);
}
console.log(
  `\n${expected.size} payments, ${held.size} ledger entries: ${missing} missing` +
    `${apply ? ` (${written} written)` : ""}, ${differs} differ, ${orphans} orphan, ${failed} failed.`
);
if (!apply && missing > 0) console.log("Dry run. Nothing changed. Add --apply to write the missing entries.");
process.exit((apply ? missing - written : missing) + differs + failed === 0 ? 0 : 1);
