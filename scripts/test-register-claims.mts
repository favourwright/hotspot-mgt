/**
 * The claim decision every sign-in runs through.
 *
 * `/api/auth/register` is called on every sign-in and the claims it writes
 * are trusted by every later request with no Firestore read at all
 * (lib/auth-helpers.ts, lib/server-auth.ts). So this one function decides,
 * on each sign-in, what every authorization check in the app will believe.
 * Both directions of getting it wrong are expensive, and both have happened:
 *
 *  - **Too permissive** copied `role` straight out of a document the browser
 *    could write, which made any customer a superadmin from the console.
 *  - **Too destructive** resolved an unconfirmable `"superadmin"` to
 *    `"customer"` and *wrote that*, so a stale SUPERADMIN_EMAIL on the VPS
 *    demoted the real superadmin on every sign-in and locked them out of
 *    /superadmin. Nothing was wrong with the account; an env value had
 *    drifted, and the code turned that into damage that repeated itself.
 *
 * The rule that keeps both out: **grant only what can be confirmed, and
 * never write a demotion from a signal about our own configuration.** An
 * unconfirmed elevation leaves the existing claims untouched.
 *
 * Run with: npm run test:register-claims
 */

import assert from "node:assert/strict";

process.env.FIREBASE_PROJECT_ID ??= "test";
process.env.FIREBASE_CLIENT_EMAIL ??= "test@test.invalid";
process.env.FIREBASE_PRIVATE_KEY ??= "test";

const { claimsFromDocument } = await import(
  "../app/api/auth/register/route.js"
);

const OWNER_UID = "owner-uid";
const TENANT = "tenant-1";

/** Stub: only TENANT exists, and OWNER_UID owns it. */
const lookup = async (tenantId: string) =>
  tenantId === TENANT ? OWNER_UID : null;

const NO_CLAIMS = { role: undefined, tenantId: undefined };

let passed = 0;
async function check(
  name: string,
  actual: Promise<unknown>,
  expected: unknown
) {
  assert.deepEqual(await actual, expected, name);
  console.log(`  ok  ${name}`);
  passed++;
}

console.log("\nsuperadmin");

await check(
  "designated address gets superadmin",
  claimsFromDocument("u", { role: "superadmin" }, true, NO_CLAIMS, lookup),
  { sync: true, role: "superadmin", tenantId: null }
);

// The regression. This must NOT come back { sync: true, role: "customer" }.
const notDesignated = await claimsFromDocument(
  "u",
  { role: "superadmin" },
  false,
  { role: "superadmin", tenantId: null },
  lookup
);
assert.equal(
  notDesignated.sync,
  false,
  "a superadmin whose address does not match must not be rewritten - this is " +
    "the lockout regression, and writing `customer` here is what caused it"
);
console.log("  ok  address mismatch refuses, and writes nothing");
passed++;

console.log("\nowner");

await check(
  "owner of the tenant it names",
  claimsFromDocument(OWNER_UID, { role: "owner", tenantId: TENANT }, false, NO_CLAIMS, lookup),
  { sync: true, role: "owner", tenantId: TENANT }
);

const stolen = await claimsFromDocument(
  "somebody-else",
  { role: "owner", tenantId: TENANT },
  false,
  NO_CLAIMS,
  lookup
);
assert.equal(stolen.sync, false, "claiming somebody else's tenant must refuse");
console.log("  ok  claiming a tenant it does not own refuses, and writes nothing");
passed++;

await check(
  "owner with no tenant is not an elevation",
  claimsFromDocument("u", { role: "owner", tenantId: null }, false, NO_CLAIMS, lookup),
  { sync: true, role: "owner", tenantId: null }
);

// The token already says owner of this tenant, so it was confirmed when it
// was granted. Re-confirming on every sign-in would be a read per login.
await check(
  "unchanged owner claim is trusted without a lookup",
  claimsFromDocument(
    "u",
    { role: "owner", tenantId: TENANT },
    false,
    { role: "owner", tenantId: TENANT },
    async () => {
      throw new Error("must not look up an unchanged claim");
    }
  ),
  { sync: true, role: "owner", tenantId: TENANT }
);

console.log("\ncustomer and legacy");

await check(
  "customer stays customer",
  claimsFromDocument("u", { role: "customer" }, false, NO_CLAIMS, lookup),
  { sync: true, role: "customer", tenantId: null }
);

await check(
  "a missing role reads as customer",
  claimsFromDocument("u", {}, false, NO_CLAIMS, lookup),
  { sync: true, role: "customer", tenantId: null }
);

// "admin" is the legacy stored value for "owner" - never migrated, by
// policy. See docs/data-model.md.
await check(
  'legacy "admin" normalises to owner',
  claimsFromDocument(OWNER_UID, { role: "admin", tenantId: TENANT }, false, NO_CLAIMS, lookup),
  { sync: true, role: "owner", tenantId: TENANT }
);

// A genuine demotion still has to work, and the document is where it comes
// from: drop the role there and the next sign-in syncs it down.
await check(
  "a real demotion in the document is honoured",
  claimsFromDocument("u", { role: "customer" }, false, { role: "superadmin", tenantId: null }, lookup),
  { sync: true, role: "customer", tenantId: null }
);

console.log(`\nAll ${passed} checks passed.\n`);
