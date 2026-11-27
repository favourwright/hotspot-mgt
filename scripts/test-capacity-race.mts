/**
 * Two (or ten) simultaneous creates against a limit leave exactly as many
 * behind as the limit allows. The rules are pure and tested in
 * test-limits.mts; this is the part only a real Firestore can show, so it
 * runs against the emulator and refuses to run anywhere else.
 *
 *   npm run test:capacity-race
 *
 * which is `firebase emulators:exec --only firestore` around this file.
 * Covers: maxRouters, one location per router, the one decision hook,
 * active API keys, a WireGuard peer claimed by one router only, who may
 * test a tunnel address, a router's
 * unused-code room across batches, and the ALREADY_EXISTS code the signup
 * reservations rely on.
 */
import { generateKeyPairSync } from "node:crypto";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set. Use `npm run test:capacity-race`.");
  process.exit(1);
}

// lib/firebase-admin initialises only with a credential, and cert() wants a
// real-looking key. A throwaway one; with the emulator host set, the SDK
// never uses it.
process.env.FIREBASE_ADMIN_PROJECT_ID = "demo-limits";
process.env.FIREBASE_ADMIN_CLIENT_EMAIL = "test@demo-limits.iam.gserviceaccount.com";
process.env.FIREBASE_ADMIN_PRIVATE_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();

// Every run starts from an empty database, so no case can be passed or
// failed by what an earlier run left behind.
await fetch(
  `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/demo-limits/databases/(default)/documents`,
  { method: "DELETE" }
);

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS, TENANT_COLLECTIONS } = await import("../lib/firebase-collections");
const { createWithinCapacity, CapacityError } = await import("../lib/tenant-capacity");
const { planLimitCheck } = await import("../lib/plan-resource-limit-check");
const { readPeerForClaim, peerId, assertTunnelAddressOwned } = await import("../lib/wg-peers");
const { createApiKey } = await import("../lib/api-keys");
const { setPlatformConfig, DEFAULT_PLATFORM_CONFIG } = await import("../lib/platform-config");
const { createBatch } = await import("../lib/voucher-generation");

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const N = 10;
const now = new Date();

async function settle<T>(tasks: Array<() => Promise<T>>) {
  const results = await Promise.allSettled(tasks.map((t) => t()));
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const unexpected = results.filter(
    (r) => r.status === "rejected" && !(r.reason instanceof CapacityError) && !(r.reason as Error)?.message?.match(/router already holds|tunnel already belongs/)
  ) as PromiseRejectedResult[];
  return { ok, unexpected: unexpected.map((r) => String(r.reason)) };
}

// A tenant on a plan that allows one router and one location.
const plan = {
  name: "Tiny",
  description: "",
  billingModel: "flat",
  monthlyFee: 0,
  platformFeePercent: 0,
  transactionFeeFlat: 0,
  billingInterval: "monthly",
  trialDays: 0,
  limits: { maxLocations: 5, maxRouters: 1, maxCustomers: null, maxGeneratedVouchers: null },
  features: { customBranding: false, prioritySupport: false },
  includedAddons: [],
  featureList: [],
  badge: null,
  contactUrl: null,
  active: true,
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};
await adminDb.collection(COLLECTIONS.BILLING_PLANS).doc("tiny").set(plan);
const tenantId = `t-${Date.now()}`;
await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).set({ slug: tenantId, planId: "tiny", createdAt: now, nextBillingDate: null });

/* ---------------------------------------------------- maxRouters */
{
  const routers = adminDb.collection(TENANT_COLLECTIONS.routers(tenantId));
  const r = await settle(
    Array.from({ length: N }, () => async () =>
      createWithinCapacity({
        tenantId,
        resource: "routers",
        checks: [await planLimitCheck(tenantId, "maxRouters")],
        write: (tx) => tx.create(routers.doc(), { name: "r", active: true, createdAt: now }),
      })
    )
  );
  const count = (await routers.count().get()).data().count;
  check("maxRouters: ten at once leave one", count === 1 && r.ok === 1, `count ${count}, ok ${r.ok}`);
  check("maxRouters: the rest are refused as full", r.unexpected.length === 0, r.unexpected.join("; "));
}

/* ---------------------------------------------------- one location per router */
{
  const routerId = (await adminDb.collection(TENANT_COLLECTIONS.routers(tenantId)).limit(1).get()).docs[0].id;
  const locations = adminDb.collection(TENANT_COLLECTIONS.locations(tenantId));
  const r = await settle(
    Array.from({ length: N }, () => async () =>
      createWithinCapacity({
        tenantId,
        resource: "locations",
        checks: [await planLimitCheck(tenantId, "maxLocations")],
        extra: async (tx) => {
          const taken = await tx.get(locations.where("routerId", "==", routerId).limit(1));
          if (!taken.empty) throw new CapacityError("taken");
        },
        write: (tx) => tx.create(locations.doc(), { name: "l", routerId, active: true }),
      })
    )
  );
  const count = (await locations.where("routerId", "==", routerId).count().get()).data().count;
  check("one location per router under a race", count === 1 && r.ok === 1, `count ${count}`);
}

/* ---------------------------------------------------- one hook */
{
  const hooks = adminDb.collection(TENANT_COLLECTIONS.hooks(tenantId));
  await settle(
    Array.from({ length: N }, () => () =>
      createWithinCapacity({
        tenantId,
        resource: "hooks",
        checks: [{ counted: hooks, allowed: 1, fullMessage: "full" }],
        write: (tx) => tx.create(hooks.doc(), { name: "h" }),
      })
    )
  );
  const count = (await hooks.count().get()).data().count;
  check("one decision hook under a race", count === 1, `count ${count}`);
}

/* ---------------------------------------------------- active API keys */
{
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, (_, i) => () =>
      createApiKey({ tenantId, name: `k${i}`, scopes: ["vouchers:read"] as never, createdBy: "u" })
    ).map((t) => t())
  );
  const active = (
    await adminDb.collection(COLLECTIONS.API_KEYS).where("tenantId", "==", tenantId).where("revokedAt", "==", null).count().get()
  ).data().count;
  check("active keys stop at the cap under a race", active === 10, `active ${active}`);
  const odd = results
    .filter((r) => r.status === "rejected" && !((r as PromiseRejectedResult).reason instanceof CapacityError))
    .map((r) => String((r as PromiseRejectedResult).reason));
  check("keys over the cap are refused cleanly (full, or busy: try again)", odd.length === 0, [...new Set(odd)].join("; "));
}

/* ---------------------------------------------------- a peer, one router */
{
  const peerTenant = `peer-${Date.now()}`;
  const peerIp = "10.20.0.50";
  const key = (Date.now().toString(36) + "x".repeat(43)).slice(0, 43) + "=";
  await adminDb.collection(COLLECTIONS.WG_PEERS).doc(peerId(key)).set({
    tenantId: peerTenant,
    publicKey: key,
    assignedIp: peerIp,
    routerId: null,
    releasedAt: null,
    createdAt: now,
  });
  const routers = adminDb.collection(TENANT_COLLECTIONS.routers(peerTenant));
  await settle(
    Array.from({ length: N }, () => () => {
      const ref = routers.doc();
      return createWithinCapacity({
        tenantId: peerTenant,
        resource: "routers",
        checks: [],
        extra: async (tx) => {
          const peer = await readPeerForClaim(tx, peerTenant, key);
          (ref as unknown as { claim: (id: string) => void }).claim = peer.claim;
        },
        write: (tx) => {
          tx.create(ref, { name: "r" });
          (ref as unknown as { claim: (id: string) => void }).claim(ref.id);
        },
      });
    })
  );
  const count = (await routers.count().get()).data().count;
  check("a tunnel is claimed by one router only", count === 1, `count ${count}`);
  let refused = false;
  try {
    await adminDb.runTransaction((tx) => readPeerForClaim(tx, "someone-else", key).then(() => undefined));
  } catch {
    refused = true;
  }
  check("another tenant cannot claim the tunnel", refused);

  const owned = async (t: string, ip: string) =>
    assertTunnelAddressOwned(t, ip).then(
      () => true,
      () => false
    );
  check("a tunnel address can be tested by its tenant", await owned(peerTenant, peerIp));
  check("but not by another tenant", !(await owned("someone-else", peerIp)));
  check("a public address is anybody's to test", await owned("someone-else", "102.89.1.1"));
  const legacyTenant = `legacy-${Date.now()}`;
  const legacyIp = "10.20.0.77";
  await adminDb.collection(TENANT_COLLECTIONS.routers(legacyTenant)).doc("old").set({ routerIp: legacyIp });
  check("a router from before the ledger is still its tenant's", await owned(legacyTenant, legacyIp));
  check("and nobody else's", !(await owned("someone-else", legacyIp)));
}

/* ---------------------------------------------------- unused codes per router */
{
  await setPlatformConfig({
    ...DEFAULT_PLATFORM_CONFIG,
    voucherGeneration: { ...DEFAULT_PLATFORM_CONFIG.voucherGeneration, maxBatchSize: 100, maxUnusedPerRouter: 150 },
  });
  const t = `g-${Date.now()}`;
  await adminDb.collection(COLLECTIONS.TENANTS).doc(t).set({ slug: t, planId: "tiny", createdAt: now, nextBillingDate: null });
  await adminDb.collection(TENANT_COLLECTIONS.routers(t)).doc("r1").set({ name: "r1", active: true });
  await adminDb.collection(TENANT_COLLECTIONS.locations(t)).doc("l1").set({ name: "l1", routerId: "r1", active: true });
  await adminDb.collection(TENANT_COLLECTIONS.plans(t)).doc("p1").set({
    name: "Day",
    locationId: "l1",
    active: true,
    price: 50000,
    duration: "1d",
    mikrotikProfile: "day",
  });
  const r = await settle(
    Array.from({ length: 3 }, (_, i) => () =>
      createBatch({
        tenantId: t,
        createdBy: { uid: "u", email: null },
        locationId: "l1",
        planId: "p1",
        count: 100,
        requestId: `race-request-${i}`,
      })
    )
  );
  const batches = (await adminDb.collection(TENANT_COLLECTIONS.voucherBatches(t)).count().get()).data().count;
  check("unused-code room holds across simultaneous batches", batches === 1 && r.ok === 1, `batches ${batches}`);
  check("the others are refused as router-full", r.unexpected.length === 0, r.unexpected.join("; "));
}

/* ---------------------------------------------------- signup reservations */
{
  const slugRef = adminDb.collection(COLLECTIONS.TENANT_SLUGS).doc(`slug-${Date.now()}`);
  const results = await Promise.allSettled(
    [1, 2].map(async () => {
      const batch = adminDb.batch();
      batch.create(slugRef, { tenantId: "x" });
      batch.set(adminDb.collection(COLLECTIONS.TENANTS).doc(), { slug: slugRef.id });
      await batch.commit();
    })
  );
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  check("a slug reservation lets one signup through", rejected.length === 1);
  check(
    "and the other fails with code 6 (ALREADY_EXISTS), which create-tenant maps to 409",
    rejected[0]?.reason?.code === 6,
    String(rejected[0]?.reason?.code)
  );
  const tenants = (await adminDb.collection(COLLECTIONS.TENANTS).where("slug", "==", slugRef.id).count().get()).data().count;
  check("and none of the failed batch is written", tenants === 1, `tenants ${tenants}`);
}

console.log(failed === 0 ? `All ${passed} cases passed.` : `${failed} failed, ${passed} passed.`);
process.exit(failed === 0 ? 0 : 1);
