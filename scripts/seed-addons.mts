/**
 * Makes the addon system safe to deploy, and safe to switch on later.
 *
 * Two separate hazards, which is why this has two modes.
 *
 * **Deploying at all.** `getEntitlementState` fails closed: an addon with no
 * Firestore document resolves to not-entitled. The captive-portal gate ships
 * in the same deploy as this file, so the moment it lands, every tenant with
 * a working portal starts serving the paywall page to their customers
 * instead of a login form. The default mode writes the addon document as
 * `free`, which keeps behaviour exactly as it is today.
 *
 * **Switching it to paid.** The instant the superadmin changes the pricing
 * model, every tenant who already installed a portal loses it, having paid
 * nothing because there was nothing to pay. `--grandfather` grants those
 * tenants a permanent, free entitlement first, so charging starts with new
 * customers rather than by taking something away from existing ones.
 *
 *   npx tsx scripts/seed-addons.mts               # safe default, idempotent
 *   npx tsx scripts/seed-addons.mts --grandfather # before going paid
 */
import dotenv from "dotenv";

// Loaded, and imported, in this order on purpose. `lib/firebase-admin`
// initialises the Admin SDK at module scope, so a static import of it would
// be evaluated before this line and would come up with no credentials.
// `dotenv/config` alone is not enough either: it reads `.env`, and this
// project keeps its server-side values in `.env.local`.
dotenv.config({ path: ".env.local", quiet: true });

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS, TENANT_COLLECTIONS } = await import(
  "../lib/firebase-collections"
);
const { ADDON_CATALOG, ADDON_KEYS } = await import("../lib/addon-catalog");

const grandfather = process.argv.includes("--grandfather");

async function seed() {
  for (const key of ADDON_KEYS) {
    const ref = adminDb.collection(COLLECTIONS.ADDONS).doc(key);
    if ((await ref.get()).exists) {
      console.log(`  ${key}: already configured, left alone`);
      continue;
    }

    const entry = ADDON_CATALOG[key];
    await ref.set({
      name: entry.name,
      description: entry.description,
      // Free, not paid. Seeding this as a priced addon would turn the
      // deploy itself into an outage for everyone already using it.
      pricingModel: "free",
      amount: 0,
      billingInterval: "monthly",
      paystackPlanCode: null,
      paystackPlanAmount: null,
      active: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`  ${key}: created as FREE (no behaviour change)`);
  }
}

/** Tenants with a captive portal installed on at least one location. */
async function tenantsUsingPortal(): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const tenants = await adminDb.collection(COLLECTIONS.TENANTS).get();

  for (const tenant of tenants.docs) {
    const locations = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenant.id))
      .get();

    const installed = locations.docs.some((d) => d.data().portalInstalledAt);
    if (installed) {
      found.set(tenant.id, tenant.data().slug ?? tenant.id);
    }
  }
  return found;
}

async function main() {
  console.log("Seeding addon catalog...");
  await seed();

  const existing = await tenantsUsingPortal();
  console.log(`\nTenants with a portal already installed: ${existing.size}`);
  for (const [id, slug] of existing) console.log(`  ${slug} (${id})`);

  if (!grandfather) {
    if (existing.size > 0) {
      console.log(
        "\nRe-run with --grandfather BEFORE changing captive-portal to paid,\n" +
          "or these tenants lose a portal they are already running."
      );
    }
    return;
  }

  console.log("\nGranting permanent entitlements...");
  for (const [tenantId, slug] of existing) {
    const ref = adminDb
      .collection(TENANT_COLLECTIONS.entitlements(tenantId))
      .doc("captive-portal");

    if ((await ref.get()).exists) {
      console.log(`  ${slug}: already has one, left alone`);
      continue;
    }

    const now = new Date();
    await ref.set({
      addonKey: "captive-portal",
      source: "purchase",
      status: "active",
      // one_time never expires and ignores currentPeriodEnd, which is
      // exactly what "they had this before we started charging" should mean.
      pricingModel: "one_time",
      paystackSubscriptionCode: null,
      paystackCustomerCode: null,
      lastPaymentRef: null,
      amountPaid: 0,
      grantedAt: now,
      currentPeriodEnd: null,
      pastDueSince: null,
      cancelledAt: null,
      updatedAt: now,
    });
    console.log(`  ${slug}: granted permanently`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
