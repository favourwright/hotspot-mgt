/**
 * Sets tenants up with a payee at Knomad Pay (a Monnify sub-account there), from the
 * bank details on their records (lib/knomad-pay-payees.ts), and reports each one.
 *
 *   npm run knomad-pay:payees                     # every tenant, dry run: checks, creates nothing
 *   npm run knomad-pay:payees -- --tenant <slug>  # one tenant
 *   npm run knomad-pay:payees -- --apply          # create the payees that check out
 *
 * A dry run still asks Knomad Pay (the bank list, name enquiries), which reads nothing
 * of the tenant's and moves no money. Account numbers are printed masked. A tenant whose
 * bank cannot be matched, or whose bank names someone else, is listed to re-pick their
 * bank in settings; nothing is created for them.
 *
 * Talks to the live Firebase project and the Knomad Pay named by KNOMAD_PAY_URL, like
 * every maintenance script (scripts/load-env.mts).
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { knomadPay } = await import("../lib/knomad-pay");
const { ensureTenantPayee } = await import("../lib/knomad-pay-payees");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;

const mask = (n: string | null | undefined) => (n ? `${"*".repeat(Math.max(0, n.length - 4))}${n.slice(-4)}` : "-");

const listed = await knomadPay().listBanks();
if (!listed.ok) {
  console.error(`Knomad Pay bank list unavailable: ${listed.code} ${listed.message}`);
  process.exit(1);
}

let query = adminDb.collection(COLLECTIONS.TENANTS) as FirebaseFirestore.Query;
if (only) query = query.where("slug", "==", only);
const snap = await query.get();
if (snap.empty) {
  console.error(only ? `No tenant with slug ${only}` : "No tenants");
  process.exit(1);
}

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${snap.size} tenant(s), ${process.env.KNOMAD_PAY_URL}\n`);
const tally: Record<string, number> = {};
for (const doc of snap.docs) {
  const t = { id: doc.id, ...(doc.data() as Record<string, unknown>) } as Parameters<typeof ensureTenantPayee>[0] & { slug?: string };
  const outcome = await ensureTenantPayee(t, { dryRun: !apply, banks: listed.data });
  tally[outcome.kind] = (tally[outcome.kind] ?? 0) + 1;
  const detail =
    outcome.kind === "ready"
      ? `${outcome.reference}${outcome.bank ? ` at ${outcome.bank.name} (${outcome.bank.code})` : ""}${outcome.created ? ", created" : apply ? ", already set" : ""}`
      : outcome.kind === "bank_unmatched"
        ? `"${outcome.storedBank}" is not a bank Monnify lists: the tenant should re-pick their bank`
        : outcome.kind === "name_mismatch"
          ? `${outcome.bank.name} names "${outcome.fromBank}", the record says "${outcome.onRecord}": the tenant should check their details`
          : outcome.kind === "unresolvable"
            ? `no bank resolves account ${mask(t.accountNumber)} (tried ${outcome.tried.map((b) => b.code).join(", ")})`
            : outcome.kind === "no_bank_details"
              ? "no bank details on record"
              : outcome.detail;
  console.log(`${outcome.kind.padEnd(16)} ${(t.slug ?? t.id).padEnd(24)} ${mask(t.accountNumber)}  ${detail}`);
}
console.log(`\n${Object.entries(tally).map(([k, n]) => `${k}: ${n}`).join(", ")}`);
if (!apply) console.log("Dry run: nothing was created. Run again with --apply.");
