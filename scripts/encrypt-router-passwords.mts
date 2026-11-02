/**
 * Encrypts every stored router password that is still plaintext.
 *
 * A dry run unless given --apply. Each password is decrypted again and compared
 * before the plaintext is removed. The write carries the document's update time, so
 * an owner changing their password at the same moment wins and is picked up by the
 * next run. Safe to repeat. Prints paths and counts, never a password.
 *
 * Uses .env.production, so this writes to the live project. Back up the key off the
 * VPS first: after this, losing it stops every router.
 *
 * Run: npm run routers:encrypt
 * Then: npm run routers:encrypt -- --apply
 */
import { FieldValue } from "firebase-admin/firestore";

import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { routerLogin, routerPasswordFields, routerSecretsConfigured } = await import(
  "../lib/router-credentials"
);

if (!routerSecretsConfigured()) {
  console.error("ROUTER_SECRETS_KEY is not set, or is not 32 bytes of base64. Nothing changed.");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const routers = await adminDb.collectionGroup("routers").get();
let encrypted = 0;
let unreadable = 0;
let failed = 0;

for (const doc of routers.docs) {
  const data = doc.data();

  try {
    // Also proves the key opens what is already encrypted.
    routerLogin(data);
  } catch {
    unreadable += 1;
    console.log(`  UNREADABLE ${doc.ref.path}`);
    continue;
  }

  if (typeof data.routerPass !== "string") continue;

  const fields = routerPasswordFields(data.routerPass);
  const roundTrip = routerLogin(fields).password;
  if (roundTrip !== data.routerPass) {
    failed += 1;
    console.log(`  ROUND TRIP FAILED ${doc.ref.path}`);
    continue;
  }

  encrypted += 1;
  console.log(`  ${apply ? "encrypted" : "would encrypt"} ${doc.ref.path}`);
  if (!apply) continue;

  try {
    await doc.ref.update(
      { ...fields, routerPass: FieldValue.delete() },
      { lastUpdateTime: doc.updateTime }
    );
  } catch (error) {
    encrypted -= 1;
    failed += 1;
    console.log(`  CHANGED OR FAILED, rerun ${doc.ref.path}: ${(error as Error).name}`);
  }
}

console.log(
  `\n${routers.size} routers, ${encrypted} ${apply ? "encrypted" : "to encrypt"}, ` +
    `${unreadable} unreadable, ${failed} failed.`
);
if (!apply) console.log("Dry run. Nothing changed. Add --apply to write.");
process.exit(unreadable + failed === 0 ? 0 : 1);
