/**
 * Read-only diagnostic: how many documents live in each collection?
 * Uses count() aggregations, so the whole report costs a handful of reads.
 * Run with: npx tsx scripts/firestore-doc-counts.ts
 */

import { loadScriptEnv } from "./load-env.mjs";

// .env.production wins; .env.development.local fills in what it leaves blank.
// See scripts/load-env.mts for why that is not simply two dotenv calls.
loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");

async function count(label: string, q: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference) {
  const snap = await q.count().get();
  console.log(`${label.padEnd(36)} ${String(snap.data().count).padStart(8)}`);
  return snap.data().count;
}

async function main() {
  console.log("\nTop-level collections");
  console.log("-".repeat(46));
  await count("tenants", adminDb.collection(COLLECTIONS.TENANTS));
  await count("users", adminDb.collection(COLLECTIONS.USERS));

  console.log("\nAcross all tenants (collection group)");
  console.log("-".repeat(46));
  for (const group of ["vouchers", "payments", "plans", "locations", "routers", "customers"]) {
    await count(group, adminDb.collectionGroup(group));
  }

  console.log("\nPer tenant");
  console.log("-".repeat(46));
  const tenants = await adminDb.collection(COLLECTIONS.TENANTS).get();
  for (const tenant of tenants.docs) {
    const name = tenant.data().slug || tenant.id;
    console.log(`\n  ${name}`);
    for (const sub of ["vouchers", "payments", "customers"]) {
      await count(`    ${sub}`, adminDb.collection(`tenants/${tenant.id}/${sub}`));
    }
  }
  console.log();
}

main().then(() => process.exit(0));
