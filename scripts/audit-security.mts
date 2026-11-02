/**
 * Read-only checks against the live project. Writes nothing,
 * prints no passwords and no secret values. Exit 1 means something needs a look.
 *
 * Two questions, and both must be answered before the first deploy of the
 * router address guard:
 *
 *  1. Who holds superadmin? `/api/auth/register` used to grant it to any account
 *     that posted the right email in a request body. An account here that is not
 *     SUPERADMIN_EMAIL got it some other way: revoke it and read the logs.
 *  2. Would any stored router be refused by lib/router-address.ts? A refused
 *     router is a venue that stops selling, so fix the data or the allowlist
 *     first. Never deploy past a finding here.
 *
 * Uses .env.production, so this reads the live project (scripts/load-env.mts).
 *
 * Run: npm run audit:security
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminAuth, adminDb } = await import("../lib/firebase-admin");
const { routerAddressKind } = await import("../lib/router-address");

const designated = (process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || "")
  .trim()
  .toLowerCase();

let findings = 0;

function mask(email: string | undefined): string {
  if (!email) return "(no email)";
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}***@${domain}`;
}

// 1. Claims: what the app actually trusts.
console.log("Superadmin claims");
let accounts = 0;
let pageToken: string | undefined;
do {
  const page = await adminAuth.listUsers(1000, pageToken);
  for (const user of page.users) {
    accounts += 1;
    if (user.customClaims?.role !== "superadmin") continue;
    const expected = (user.email ?? "").toLowerCase() === designated;
    if (!expected) findings += 1;
    console.log(
      `  ${expected ? "ok      " : "UNEXPECTED"} ${user.uid} ${mask(user.email)} ` +
        `verified=${user.emailVerified} created=${user.metadata.creationTime}`
    );
  }
  pageToken = page.pageToken;
} while (pageToken);
console.log(`  ${accounts} accounts scanned`);

// Documents: what the next sign-in would turn into claims.
console.log("\nSuperadmin documents");
const superDocs = await adminDb.collection("users").where("role", "==", "superadmin").get();
for (const doc of superDocs.docs) {
  const email = String(doc.data().email ?? "");
  const expected = email.toLowerCase() === designated;
  if (!expected) findings += 1;
  console.log(`  ${expected ? "ok      " : "UNEXPECTED"} ${doc.id} ${mask(email)}`);
}

// 2. Routers, by the same function the guard runs.
console.log("\nStored router addresses");
const routers = await adminDb.collectionGroup("routers").get();
for (const router of routers.docs) {
  const data = router.data();
  for (const field of ["routerIp", "wireguardTunnelIp"] as const) {
    const value = data[field];
    if (value === undefined || value === null || value === "") continue;
    if (!routerAddressKind(value)) {
      findings += 1;
      console.log(`  REFUSED  ${router.ref.path} ${field}=${String(value)} method=${data.connectionMethod}`);
    }
  }
}
console.log(`  ${routers.size} routers checked`);

console.log(findings === 0 ? "\nNothing to act on." : `\n${findings} finding(s) above need a look.`);
process.exit(findings === 0 ? 0 : 1);
