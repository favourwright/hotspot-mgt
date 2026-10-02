/**
 * Grants superadmin custom claims to the account named by SUPERADMIN_EMAIL
 * (or ADMIN_EMAIL), using Firebase Auth only — no Firestore reads, so this
 * works even while the Firestore quota is exhausted.
 *
 * This is the same backfill the app does on its own once Firestore is
 * reachable; it only grants the role the environment already designates.
 *
 * Run with: npx tsx scripts/set-superadmin-claims.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const { adminAuth } = await import("../lib/firebase-admin");

async function main() {
  const email = (process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL || "")
    .toLowerCase()
    .trim();

  if (!email) {
    console.error("SUPERADMIN_EMAIL (or ADMIN_EMAIL) is not set in .env.local");
    process.exit(1);
  }

  const user = await adminAuth.getUserByEmail(email);
  console.log(`Found auth user ${user.uid} (${user.email})`);
  console.log("Existing claims:", user.customClaims ?? "(none)");

  await adminAuth.setCustomUserClaims(user.uid, {
    role: "superadmin",
    tenantId: null,
  });

  const updated = await adminAuth.getUser(user.uid);
  console.log("New claims:", updated.customClaims);
  console.log("\nSign out and back in to pick them up.");
}

main().then(() => process.exit(0));
