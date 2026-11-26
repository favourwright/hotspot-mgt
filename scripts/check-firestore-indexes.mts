/**
 * Does every query this app actually runs have an index behind it?
 *
 * This exists because the failure it catches is uniquely bad at hiding.
 * Adding a `where` to a query that already has an `orderBy` needs a
 * composite index, and nothing says so: `tsc` is happy, `npm run build` is
 * happy, every test passes, and the query works fine against an emulator or
 * an empty collection. It fails at runtime, in production, on exactly one
 * page, with `9 FAILED_PRECONDITION`.
 *
 * It has happened twice:
 *
 *  - `/admin/users` went down completely when `getMergedHotspotUsers` began
 *    reading plans by location, which added `locationId` to a query already
 *    ordered by `createdAt`.
 *  - the transactions page's email lookup had **never** worked in
 *    production, from the day it shipped. Nobody had pasted an email into
 *    that box; a reference, which needs no composite index, works.
 *
 * So: every shape below is a query the code really runs, named by its call
 * site. Run this after touching any query, and before a deploy that
 * includes one.
 *
 *   npm run check:indexes
 *
 * Read-only and cheap - each case is `limit(1)`, and the ones that matter
 * fail before reading anything at all. It asks the live project, because
 * which indexes exist is a fact about the deployed database, not about
 * `firestore.indexes.json`: a shape listed in that file but never deployed
 * fails here, which is the point.
 */

import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const { adminDb } = await import("../lib/firebase-admin");
const { COLLECTIONS } = await import("../lib/firebase-collections");
const { AggregateField } = await import("firebase-admin/firestore");

/**
 * Field values are deliberately nonsense. A composite index is required for
 * the *shape* of a query, so whether anything matches is irrelevant - and
 * matching nothing keeps this free.
 */
const NEVER = "\u0000check-indexes-no-match";
const SOME_DATE = new Date();

interface Case {
  /** What runs this, so a failure names the thing that will break. */
  where: string;
  build: (tenantPath: string) => FirebaseFirestore.Query;
  /**
   * The aggregation the call site runs, when it runs one. Then the case runs
   * that instead of `limit(1)`, because a `sum()` needs an index on the
   * summed field that a plain read of the same query never asks for: the
   * dashboard's today-with-cash-sales query passed as `limit(1)` and failed
   * in production as an aggregation. Keep the filters matching little, since
   * an aggregation reads every entry the query matches.
   */
  aggregate?: FirebaseFirestore.AggregateSpec;
}

const CASES: Case[] = [
  // --- fulfilment ledgers (top-level; the tenant path is unused) ----------
  {
    where: "listPaymentReviews - /superadmin/payment-reviews",
    build: () =>
      adminDb
        .collection(COLLECTIONS.PAYMENT_REVIEWS)
        .orderBy("createdAt", "desc")
        .limit(1),
  },
  {
    where: "purgeExpiredLedgers (pending purchases) - payment-reconcile cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.PENDING_PURCHASES)
        .where("deleteAt", "<=", SOME_DATE)
        .limit(1),
  },
  {
    where: "purgeExpiredLedgers (hook calls) - payment-reconcile cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.HOOK_CALLS)
        .where("deleteAt", "<=", SOME_DATE)
        .limit(1),
  },
  {
    where: "purgeExpiredLedgers (link states) - payment-reconcile cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.HOOK_LINK_STATES)
        .where("deleteAt", "<=", SOME_DATE)
        .limit(1),
  },
  {
    where: "listTenantKeys - /admin/api-keys",
    build: () =>
      adminDb.collection(COLLECTIONS.API_KEYS).where("tenantId", "==", NEVER).limit(1),
  },
  {
    where: "getPlatformRevenue (by source) - /superadmin/billing",
    build: () => adminDb.collection(COLLECTIONS.PLATFORM_REVENUE).where("source", "==", NEVER),
    aggregate: { total: AggregateField.sum("amountKobo") },
  },
  {
    where: "getPlatformRevenue (by source, this month) - /superadmin/billing",
    build: () =>
      adminDb
        .collection(COLLECTIONS.PLATFORM_REVENUE)
        .where("source", "==", NEVER)
        .where("occurredAt", ">=", SOME_DATE),
    aggregate: { total: AggregateField.sum("amountKobo") },
  },
  {
    where: "getTenantEarnings (paid to platform) - /superadmin/billing",
    build: () => adminDb.collection(COLLECTIONS.PLATFORM_REVENUE).where("tenantId", "==", NEVER),
    aggregate: { total: AggregateField.sum("amountKobo") },
  },
  {
    where: "reconcile-platform-revenue (credit grants with an amount) - script",
    build: () => adminDb.collectionGroup("creditLedger").where("amountReceivedKobo", ">", 0),
  },
  {
    where: "getTenantEarnings (cash sales) - /superadmin/billing",
    build: (t) => adminDb.collection(`${t}/vouchers`).where("cashSaleKobo", "!=", null),
    aggregate: { count: AggregateField.count(), total: AggregateField.sum("cashSaleKobo") },
  },
  {
    where: "getTenantStats (all time, with cash sales) - tenant dashboard",
    build: (t) => adminDb.collection(`${t}/vouchers`),
    aggregate: { count: AggregateField.count(), cash: AggregateField.sum("cashSaleKobo") },
  },
  {
    where: "getTenantStats (today, with cash sales) - tenant dashboard",
    build: (t) => adminDb.collection(`${t}/vouchers`).where("createdAt", ">=", SOME_DATE),
    aggregate: { count: AggregateField.count(), cash: AggregateField.sum("cashSaleKobo") },
  },
  {
    where: "getGenerationQuota (unused codes) - /admin/generate",
    build: (t) => adminDb.collection(`${t}/voucherBatches`),
    aggregate: { total: AggregateField.sum("unusedCount") },
  },
  {
    where: "getGenerationQuota (unused value) - /admin/generate",
    build: (t) => adminDb.collection(`${t}/voucherBatches`),
    aggregate: { total: AggregateField.sum("unusedValueKobo") },
  },
  {
    where: "getActiveCustomerCount - maxCustomers",
    build: (t) =>
      adminDb
        .collection(`${t}/customers`)
        .where("lastPurchaseAt", ">=", SOME_DATE)
        .limit(1),
  },
  {
    where: "GET /api/v1/customers - paged by joinedAt",
    build: (t) =>
      adminDb
        .collection(`${t}/customers`)
        .orderBy("joinedAt", "desc")
        .orderBy("__name__", "desc")
        .limit(1),
  },
  {
    where: "runDueDeliveries - webhook-deliver cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.WEBHOOK_DELIVERIES)
        .where("status", "==", "pending")
        .where("nextAttemptAt", "<=", SOME_DATE)
        .orderBy("nextAttemptAt", "asc")
        .limit(1),
  },
  {
    where: "listEndpointDeliveries - /admin/webhooks delivery log",
    build: () =>
      adminDb
        .collection(COLLECTIONS.WEBHOOK_DELIVERIES)
        .where("endpointId", "==", NEVER)
        .orderBy("createdAt", "desc")
        .limit(1),
  },
  {
    where: "purgeExpiredLedgers (webhook events and deliveries) - payment-reconcile cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.WEBHOOK_DELIVERIES)
        .where("deleteAt", "<=", SOME_DATE)
        .limit(1),
  },
  {
    where: "listHookCalls - /admin/hooks call log",
    build: () =>
      adminDb
        .collection(COLLECTIONS.HOOK_CALLS)
        .where("hookId", "==", NEVER)
        .orderBy("createdAt", "desc")
        .limit(1),
  },
  {
    where: "purgeExpiredLedgers - payment-reconcile cron",
    build: () =>
      adminDb
        .collection(COLLECTIONS.FULFILMENTS)
        .where("deleteAt", "<=", SOME_DATE)
        .limit(1),
  },

  // --- plans -------------------------------------------------------------
  {
    where: "getTenantPlans(tenantId, locationId) - /admin/users, /api/admin/plans?locationId",
    build: (t) =>
      adminDb
        .collection(`${t}/plans`)
        .where("locationId", "==", NEVER)
        .orderBy("createdAt", "desc"),
  },
  {
    where: "getCachedActivePlans - storefront and captive portal",
    build: (t) => adminDb.collection(`${t}/plans`).where("active", "==", true),
  },

  // --- locations and routers --------------------------------------------
  {
    where: "getTenantLocations(tenantId, activeOnly)",
    build: (t) =>
      adminDb
        .collection(`${t}/locations`)
        .where("active", "==", true)
        .orderBy("createdAt", "desc"),
  },
  {
    where: "getTenantRouters(tenantId, activeOnly)",
    build: (t) =>
      adminDb
        .collection(`${t}/routers`)
        .where("active", "==", true)
        .orderBy("createdAt", "desc"),
  },

  // --- vouchers ----------------------------------------------------------
  {
    where: "queryVouchers - /admin/vouchers, /admin/failed (status filter)",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("status", "==", "active")
        .orderBy("createdAt", "desc")
        .orderBy("__name__", "desc"),
  },
  {
    where: "queryVouchers - date filter with no status",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("createdAt", ">=", SOME_DATE)
        .orderBy("createdAt", "desc")
        .orderBy("__name__", "desc"),
  },
  {
    where: "queryVouchers - status and date filter together",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("status", "==", "active")
        .where("createdAt", ">=", SOME_DATE)
        .orderBy("createdAt", "desc")
        .orderBy("__name__", "desc"),
  },
  {
    where: "lookupVouchers by email - /admin/vouchers lookup box",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("userEmail", "==", NEVER)
        .orderBy("createdAt", "desc"),
  },
  {
    where: "getCustomerVouchers - renewal decision during fulfilment",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("userId", "==", NEVER)
        .orderBy("createdAt", "desc"),
  },
  {
    where: "lastVoucherForDevice - captive portal welcome-back card",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("deviceMac", "==", NEVER)
        .orderBy("createdAt", "desc"),
  },

  // --- payments ----------------------------------------------------------
  {
    where: "queryTransactions - /admin/transactions (status filter)",
    build: (t) =>
      adminDb
        .collection(`${t}/payments`)
        .where("status", "==", "success")
        .orderBy("createdAt", "desc")
        .orderBy("__name__", "desc"),
  },
  {
    where: "lookupTransactions by email - /admin/transactions lookup box",
    build: (t) =>
      adminDb
        .collection(`${t}/payments`)
        .where("userEmail", "==", NEVER)
        .orderBy("createdAt", "desc"),
  },
  {
    where: "getTransactionTotals - sum(amount) over successful charges",
    build: (t) =>
      adminDb
        .collection(`${t}/payments`)
        .where("status", "==", "success")
        .where("createdAt", ">=", SOME_DATE),
  },

  // --- collection groups (the cron jobs) ---------------------------------
  {
    where: "voucher-expiry cron - expiring and stale sweeps",
    build: () =>
      adminDb
        .collectionGroup("vouchers")
        .where("status", "==", "active")
        .where("expiresAt", ">=", SOME_DATE),
  },
  {
    where: "voucher-reap cron - cursor walk over finished vouchers",
    build: () =>
      adminDb
        .collectionGroup("vouchers")
        .where("status", "==", "expired")
        .orderBy("expiresAt", "asc"),
  },
  {
    where: "voucher-reap cron - who else holds this username",
    build: (t) =>
      adminDb
        .collection(`${t}/vouchers`)
        .where("username", "in", ["AAAAAAAA", "BBBBBBBB"]),
  },
  {
    where: "getPlatformStats - platform share across all tenants",
    build: () =>
      adminDb
        .collectionGroup("payments")
        .where("status", "==", "success")
        .where("createdAt", ">=", SOME_DATE),
  },
  {
    where: "router-health cron - routers by status",
    build: () =>
      adminDb.collectionGroup("routers").where("status", "==", "online"),
  },
];

const tenants = await adminDb.collection(COLLECTIONS.TENANTS).limit(1).get();
if (tenants.empty) {
  console.error(
    "No tenants in this project, so the per-tenant subcollection paths cannot\n" +
      "be built. Nothing was checked."
  );
  process.exit(1);
}
const tenantPath = `${COLLECTIONS.TENANTS}/${tenants.docs[0].id}`;

console.log(`\nChecking ${CASES.length} query shapes\n`);

const missing: string[] = [];
const errored: string[] = [];

for (const testCase of CASES) {
  try {
    const query = testCase.build(tenantPath);
    await (testCase.aggregate ? query.aggregate(testCase.aggregate).get() : query.limit(1).get());
    console.log(`  ok      ${testCase.where}`);
  } catch (error) {
    const message = String(error);
    if (message.includes("FAILED_PRECONDITION")) {
      missing.push(testCase.where);
      console.log(`  MISSING ${testCase.where}`);
    } else {
      // Not an index problem - a credential, a network fault, a renamed
      // collection. Reported separately so it cannot be read as a pass.
      errored.push(`${testCase.where}: ${message.split("\n")[0]}`);
      console.log(`  ERROR   ${testCase.where}`);
    }
  }
}

if (errored.length > 0) {
  console.error(`\n${errored.length} case(s) failed for another reason:`);
  for (const line of errored) console.error(`  ${line}`);
}

if (missing.length > 0) {
  console.error(
    `\n${missing.length} quer${missing.length === 1 ? "y" : "ies"} ${
      missing.length === 1 ? "has" : "have"
    } no index. Whatever uses ${missing.length === 1 ? "it" : "them"} is\n` +
      "returning 500 in production right now.\n\n" +
      "Add the index to firestore.indexes.json and deploy it:\n" +
      "  firebase deploy --only firestore:indexes\n\n" +
      "A newly added index takes a moment to build; until it finishes the\n" +
      "query fails with an explicit \"index is currently building\" message\n" +
      "rather than misbehaving silently."
  );
  process.exit(1);
}

if (errored.length > 0) process.exit(1);

console.log(`\nAll ${CASES.length} query shapes have an index.\n`);
