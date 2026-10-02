/**
 * Script to manually fix admin role in Firestore
 * Run with: npx tsx scripts/fix-admin-role.ts
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { adminDb } from "../lib/firebase-admin";
import { USERS_COLLECTION } from "../lib/firebase-collections";

async function fixAdminRole() {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    console.error("❌ ADMIN_EMAIL not set in environment variables");
    console.log("\n📋 Current ADMIN_EMAIL:", process.env.ADMIN_EMAIL);
    console.log("📂 Looking for .env.local in:", process.cwd());
    process.exit(1);
  }

  console.log(`🔍 Looking for user with email: ${adminEmail}`);

  try {
    // Query for user with admin email
    const usersRef = adminDb.collection(USERS_COLLECTION);
    const snapshot = await usersRef.where("email", "==", adminEmail).get();

    if (snapshot.empty) {
      console.error(`❌ No user found with email: ${adminEmail}`);
      console.log("\n💡 Make sure you've registered with this email first!");
      process.exit(1);
    }

    // Update the role to admin
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    console.log(`\n📋 Found user:`);
    console.log(`   UID: ${userData.uid}`);
    console.log(`   Email: ${userData.email}`);
    console.log(`   Current Role: ${userData.role}`);

    if (userData.role === "admin") {
      console.log("\n✅ User already has admin role!");
      process.exit(0);
    }

    // Update to admin
    await usersRef.doc(userDoc.id).update({
      role: "admin",
    });

    // Role is resolved from the token's custom claims, so the document write
    // alone would have no effect on what the server sees.
    const { syncUserClaims } = await import("../lib/auth-claims-admin");
    await syncUserClaims(userDoc.id, "owner", userData.tenantId ?? null);

    console.log(`\n✅ Successfully updated role to admin!`);
    console.log(`\n🎉 Sign out and back in to pick up the new role.`);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

fixAdminRole();
