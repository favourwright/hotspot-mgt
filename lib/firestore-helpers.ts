import { startOfTodayInDisplayZone } from "@/lib/utils";
import {
  AggregateField,
  DocumentSnapshot,
  QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import {
  UserSchema,
  LocationSchema,
  RouterSchema,
  PlanSchema,
  VoucherSchema,
  PaymentSchema,
  TenantSchema,
  TenantCustomerSchema,
  VoucherCredentialSchema,
  User,
  Location,
  Router,
  Plan,
  Voucher,
  Payment,
  Tenant,
  TenantCustomer,
  VoucherCredential,
} from "@/types/schemas";

/**
 * Helper to convert Firestore Timestamp to Date
 */
function timestampToDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return new Date();
}

/**
 * Recursively convert all Timestamp fields to Date in an object
 */
function convertTimestamps(data: any): any {
  if (!data || typeof data !== "object") return data;

  if (data instanceof Timestamp) {
    return data.toDate();
  }

  if (Array.isArray(data)) {
    return data.map(convertTimestamps);
  }

  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = convertTimestamps(value);
  }
  return result;
}

/**
 * Safely parse a Firestore document as a User
 */
export function parseUser(doc: DocumentSnapshot | QueryDocumentSnapshot): User | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return UserSchema.parse({ uid: doc.id, ...data });
}

/**
 * Safely parse a Firestore document as a Location
 */
export function parseLocation(doc: DocumentSnapshot | QueryDocumentSnapshot): Location | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return LocationSchema.parse({ id: doc.id, ...data });
}

/**
 * Safely parse a Firestore document as a Router
 */
export function parseRouter(doc: DocumentSnapshot | QueryDocumentSnapshot): Router | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return RouterSchema.parse({ id: doc.id, ...data });
}

/**
 * Safely parse a Firestore document as a Plan
 */
export function parsePlan(doc: DocumentSnapshot | QueryDocumentSnapshot): Plan | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return PlanSchema.parse({ id: doc.id, ...data });
}

/**
 * Safely parse a Firestore document as a Voucher
 */
export function parseVoucher(doc: DocumentSnapshot | QueryDocumentSnapshot): Voucher | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return VoucherSchema.parse({ id: doc.id, ...data });
}

/**
 * Safely parse a Firestore document as a Payment
 */
export function parsePayment(doc: DocumentSnapshot | QueryDocumentSnapshot): Payment | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return PaymentSchema.parse({ id: doc.id, ...data });
}

/**
 * Batch parse multiple documents of the same type
 */
export function parseUsers(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): User[] {
  return docs.map(parseUser).filter((u): u is User => u !== null);
}

export function parseLocations(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Location[] {
  return docs.map(parseLocation).filter((l): l is Location => l !== null);
}

export function parseRouters(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Router[] {
  return docs.map(parseRouter).filter((r): r is Router => r !== null);
}

export function parsePlans(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Plan[] {
  return docs.map(parsePlan).filter((p): p is Plan => p !== null);
}

export function parseVouchers(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Voucher[] {
  return docs.map(parseVoucher).filter((v): v is Voucher => v !== null);
}

export function parsePayments(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Payment[] {
  return docs.map(parsePayment).filter((p): p is Payment => p !== null);
}

/**
 * Safely parse a Firestore document as a Tenant
 */
export function parseTenant(doc: DocumentSnapshot | QueryDocumentSnapshot): Tenant | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return TenantSchema.parse({ id: doc.id, ...data });
}

export function parseTenants(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): Tenant[] {
  return docs.map(parseTenant).filter((t): t is Tenant => t !== null);
}

/**
 * Safely parse a Firestore document as a TenantCustomer
 */
export function parseTenantCustomer(doc: DocumentSnapshot | QueryDocumentSnapshot): TenantCustomer | null {
  if (!doc.exists) return null;
  
  const data = convertTimestamps(doc.data());
  return TenantCustomerSchema.parse({ ...data });
}

export function parseTenantCustomers(docs: (DocumentSnapshot | QueryDocumentSnapshot)[]): TenantCustomer[] {
  return docs.map(parseTenantCustomer).filter((t): t is TenantCustomer => t !== null);
}

/**
 * Look up a tenant by slug (server-side only)
 * Used by middleware and API routes to resolve 
 * the tenant from the URL slug
 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { COLLECTIONS } = await import("@/lib/firebase-collections");
  
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("slug", "==", slug)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return parseTenant(snapshot.docs[0]);
}

/**
 * Look up a tenant by owner UID (server-side only)
 * Used after owner login to load their tenant context
 */
export async function getTenantByOwnerUid(ownerUid: string): Promise<Tenant | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { COLLECTIONS } = await import("@/lib/firebase-collections");
  
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("ownerUid", "==", ownerUid)
    .limit(1)
    .get();
  
  if (snapshot.empty) return null;
  return parseTenant(snapshot.docs[0]);
}

/**
 * Check if a slug is already taken (server-side only)
 * Used during tenant onboarding
 */
export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { COLLECTIONS } = await import("@/lib/firebase-collections");
  
  const snapshot = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .where("slug", "==", slug)
    .limit(1)
    .get();
  
  return snapshot.empty;
}

/**
 * Fetch all active locations for a tenant
 */
export async function getTenantLocations(
  tenantId: string,
  activeOnly = false
): Promise<Location[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .orderBy("createdAt", "desc");

  if (activeOnly) {
    query = query.where("active", "==", true) as FirebaseFirestore.Query;
  }

  const snapshot = await query.get();
  return parseLocations(snapshot.docs);
}

/**
 * Fetch all routers for a tenant
 */
export async function getTenantRouters(
  tenantId: string,
  activeOnly = false
): Promise<Router[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .orderBy("createdAt", "desc");

  if (activeOnly) {
    query = query.where("active", "==", true) as FirebaseFirestore.Query;
  }

  const snapshot = await query.get();
  return parseRouters(snapshot.docs);
}

/**
 * Fetch all plans for a tenant, optionally
 * filtered by locationId
 */
export async function getTenantPlans(
  tenantId: string,
  locationId?: string
): Promise<Plan[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.plans(tenantId))
    .orderBy("createdAt", "desc");

  if (locationId) {
    query = query.where("locationId", "==", locationId) as FirebaseFirestore.Query;
  }

  const snapshot = await query.get();
  return parsePlans(snapshot.docs);
}

/**
 * Fetch all vouchers for a tenant
 */
export async function getTenantVouchers(
  tenantId: string,
  status?: "active" | "expired" | "failed" | "superseded",
  max?: number
): Promise<Voucher[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .orderBy("createdAt", "desc");

  if (status) {
    query = query.where("status", "==", status) as FirebaseFirestore.Query;
  }

  // Callers that only render the first N rows must pass `max` - without it
  // this reads (and bills) every voucher the tenant has ever issued.
  if (max) {
    query = query.limit(max);
  }

  const snapshot = await query.get();
  return parseVouchers(snapshot.docs);
}

/**
 * One customer's recent vouchers at one tenant, newest first.
 *
 * What the renewal decision reads (lib/voucher-renewal.ts): whether this
 * person already holds a live credential for the plan they are buying
 * again. Deliberately not filtered on `planId` or `status` in the query -
 * that would need a composite index, and the existing `userId` + `createdAt`
 * one already covers this. A customer's own voucher history is small, so the
 * filtering happens in memory, the same way `getTenantVouchersByLocation`
 * handles `archivedAt`.
 *
 * `max` is a real bound, not a nicety: this runs inside fulfilment, on the
 * path a buyer is waiting on. Twenty is far more history than any decision
 * here looks at, since only vouchers still running can be acted on.
 */
export async function getCustomerVouchers(
  tenantId: string,
  userId: string,
  max = 20
): Promise<Voucher[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
    .limit(max)
    .get();

  return parseVouchers(snapshot.docs);
}

/**
 * Vouchers issued at one location - the platform half of the hotspot-user
 * reconciliation (see lib/hotspot-users.ts), joined to router users by
 * username.
 */
export async function getTenantVouchersByLocation(
  tenantId: string,
  locationId: string
): Promise<Voucher[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("locationId", "==", locationId)
    .get();

  // Archived vouchers are filtered in memory rather than in the query: an
  // inequality on `archivedAt` would need a composite index and would also
  // drop every voucher written before the field existed, which is all of
  // them. This is the reconciliation view only -- dashboards and the voucher
  // list deliberately still count archived rows, since the sale happened.
  return parseVouchers(snapshot.docs).filter((v) => !v.archivedAt);
}

/**
 * Fetch all payments for a tenant
 */
export async function getTenantPayments(
  tenantId: string,
  max?: number
): Promise<Payment[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .orderBy("createdAt", "desc") as FirebaseFirestore.Query;

  // See getTenantVouchers: unbounded by default, so list views that show a
  // fixed number of rows should ask for exactly that many.
  if (max) {
    query = query.limit(max);
  }

  const snapshot = await query.get();
  return parsePayments(snapshot.docs);
}

/**
 * The payment behind a voucher, for the user detail view. Payments carry
 * voucherId once the voucher is created, so this is a single indexed
 * lookup rather than a scan.
 */
export async function getTenantPaymentForVoucher(
  tenantId: string,
  voucherId: string
): Promise<Payment | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .where("voucherId", "==", voucherId)
    .limit(1)
    .get();

  if (snapshot.empty) return null;
  return parsePayment(snapshot.docs[0]);
}

/**
 * Look up a single customer record for a tenant (used to tell an existing
 * customer apart from a brand-new one for limit enforcement).
 */
export async function getTenantCustomer(
  tenantId: string,
  uid: string
): Promise<TenantCustomer | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const doc = await adminDb
    .collection(TENANT_COLLECTIONS.customers(tenantId))
    .doc(uid)
    .get();

  return parseTenantCustomer(doc);
}

/**
 * A customer's chosen voucher username and password at one tenant, or null
 * if they never set any (which is most of them - the feature is opt-in and
 * everyone else keeps getting random codes).
 *
 * Read on the fulfilment path, so it stays a single get by document id.
 */
export async function getVoucherCredential(
  tenantId: string,
  uid: string
): Promise<VoucherCredential | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const doc = await adminDb
    .collection(TENANT_COLLECTIONS.voucherCredentials(tenantId))
    .doc(uid)
    .get();

  if (!doc.exists) return null;

  const parsed = VoucherCredentialSchema.safeParse(
    convertTimestamps({ ...doc.data(), uid: doc.id })
  );
  return parsed.success ? parsed.data : null;
}

/**
 * Customers who have paid this tenant in the last 30 days - what a plan's
 * limits.maxCustomers is measured against (lib/active-customers.ts). Uses a
 * Firestore count() aggregation query rather than reading every customer
 * document.
 */
export async function getActiveCustomerCount(
  tenantId: string,
  now: Date = new Date()
): Promise<number> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");
  const { activeCustomerWindowStart } = await import("@/lib/active-customers");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.customers(tenantId))
    .where("lastPurchaseAt", ">=", activeCustomerWindowStart(now))
    .count()
    .get();

  return snapshot.data().count;
}

/**
 * Fetch tenant admin stats
 */
export async function getTenantStats(
  tenantId: string
): Promise<{
  /** Online sales, from `payments`. */
  totalRevenue: number;
  /** Generated codes sold for cash, counted at first use. */
  cashSales: number;
  totalVouchers: number;
  activeVouchers: number;
  failedVouchers: number;
  todayRevenue: number;
  todayCashSales: number;
  todayVouchers: number;
  routerCount: number;
  locationCount: number;
  planCount: number;
}> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  // Midnight in Lagos, not in whatever zone this process runs in. The VPS
  // is UTC, so `setHours(0,0,0,0)` made "today" run 01:00 to 01:00 for every
  // person who reads the number.
  const today = startOfTodayInDisplayZone();

  const payments = adminDb.collection(TENANT_COLLECTIONS.payments(tenantId));
  const vouchers = adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId));
  const routers = adminDb.collection(TENANT_COLLECTIONS.routers(tenantId));
  const locations = adminDb.collection(TENANT_COLLECTIONS.locations(tenantId));
  const plans = adminDb.collection(TENANT_COLLECTIONS.plans(tenantId));

  // Aggregation queries are billed per batch of index entries rather than per
  // document, so these stats cost a handful of reads instead of a full scan.
  const [
    successPayments,
    totalVouchers,
    activeVouchers,
    failedVouchers,
    todayPayments,
    todayVouchers,
    routerCount,
    locationCount,
    planCount,
  ] = await Promise.all([
    payments
      .where("status", "==", "success")
      .aggregate({ total: AggregateField.sum("amount") })
      .get(),
    // Cash sales ride the voucher count's aggregation rather than a query
    // of their own: only a generated voucher carries `cashSaleKobo`, and
    // `sum()` skips documents without it, the same way the platform total
    // skips payments from before `platformShareKobo` existed. Never filter
    // on `source` instead (docs/decisions-and-gotchas.md).
    vouchers
      .aggregate({ count: AggregateField.count(), cash: AggregateField.sum("cashSaleKobo") })
      .get(),
    vouchers.where("status", "==", "active").count().get(),
    vouchers.where("status", "==", "failed").count().get(),
    payments
      .where("status", "==", "success")
      .where("createdAt", ">=", today)
      .aggregate({ total: AggregateField.sum("amount") })
      .get(),
    // A generated voucher's `createdAt` is its first use, so "today" means
    // sold today here exactly as it does for an online sale.
    vouchers
      .where("createdAt", ">=", today)
      .aggregate({ count: AggregateField.count(), cash: AggregateField.sum("cashSaleKobo") })
      .get(),
    // Setup progress for the dashboard's next-step action. Unfiltered
    // `count()` needs no composite index and bills a single read each, and
    // they ride the same cache as everything else here.
    routers.count().get(),
    locations.count().get(),
    plans.count().get(),
  ]);

  return {
    totalRevenue: successPayments.data().total,
    cashSales: totalVouchers.data().cash ?? 0,
    totalVouchers: totalVouchers.data().count,
    activeVouchers: activeVouchers.data().count,
    failedVouchers: failedVouchers.data().count,
    todayRevenue: todayPayments.data().total,
    todayCashSales: todayVouchers.data().cash ?? 0,
    todayVouchers: todayVouchers.data().count,
    routerCount: routerCount.data().count,
    locationCount: locationCount.data().count,
    planCount: planCount.data().count,
  };
}

/**
 * Get all tenants (superadmin only)
 */
export async function getAllTenants(options?: {
  status?: "active" | "suspended" | "pending";
  limit?: number;
}): Promise<Tenant[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(COLLECTIONS.TENANTS)
    .orderBy("createdAt", "desc");

  if (options?.status) {
    query = query.where("status", "==", options.status) as FirebaseFirestore.Query;
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const snapshot = await query.get();
  return parseTenants(snapshot.docs);
}

/**
 * Get platform-wide stats (superadmin only)
 */
export async function getPlatformStats(): Promise<{
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  pendingTenants: number;
  totalVouchersAllTenants: number;
  totalRevenueAllTenants: number;
  todayRevenueAllTenants: number;
  mrr: number;
}> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { COLLECTIONS } = await import("@/lib/firebase-collections");

  // Midnight in Lagos, not in whatever zone this process runs in. The VPS
  // is UTC, so `setHours(0,0,0,0)` made "today" run 01:00 to 01:00 for every
  // person who reads the number.
  const today = startOfTodayInDisplayZone();

  const tenants = adminDb.collection(COLLECTIONS.TENANTS);

  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    pendingTenants,
    activeVouchers,
    successPayments,
    todayPayments,
  ] = await Promise.all([
    tenants.count().get(),
    // Count and MRR come from one aggregation over active tenants.
    tenants
      .where("status", "==", "active")
      .aggregate({
        count: AggregateField.count(),
        mrr: AggregateField.sum("monthlyFee"),
      })
      .get(),
    tenants.where("status", "==", "suspended").count().get(),
    tenants.where("status", "==", "pending").count().get(),
    adminDb
      .collectionGroup("vouchers")
      .where("status", "==", "active")
      .count()
      .get(),
    adminDb
      .collectionGroup("payments")
      .where("status", "==", "success")
      .aggregate({ total: AggregateField.sum("platformShareKobo") })
      .get(),
    adminDb
      .collectionGroup("payments")
      .where("status", "==", "success")
      .where("createdAt", ">=", today)
      .aggregate({ total: AggregateField.sum("platformShareKobo") })
      .get(),
  ]);

  return {
    totalTenants: totalTenants.data().count,
    activeTenants: activeTenants.data().count,
    suspendedTenants: suspendedTenants.data().count,
    pendingTenants: pendingTenants.data().count,
    totalVouchersAllTenants: activeVouchers.data().count,
    totalRevenueAllTenants: successPayments.data().total,
    todayRevenueAllTenants: todayPayments.data().total,
    mrr: activeTenants.data().mrr,
  };
}

/**
 * Per-tenant voucher-sale earnings, for the superadmin billing page.
 */
export interface TenantEarnings {
  /** Everything customers paid through this tenant's portal. */
  grossKobo: number;
  /** The platform's cut of that, as the sale was split. */
  platformShareKobo: number;
  paymentCount: number;
  /**
   * Generated codes the tenant sold for cash, at first use. Theirs alone:
   * the money never passed through the platform, so it has no share.
   */
  cashSalesKobo: number;
  cashSaleCount: number;
}

/**
 * How many tenants' aggregates we let run at once. Each one is a separate
 * round-trip, and the point of this function is to stay cheap - firing an
 * unbounded number of them in parallel is how a "cheap" query turns into a
 * connection pile-up the first time the platform has a hundred tenants.
 */
const EARNINGS_CONCURRENCY = 8;

/**
 * Sums each tenant's successful payments into one row per tenant.
 *
 * This is one *aggregation* query per tenant, never a document scan. The
 * distinction is the whole reason this is affordable: an aggregation bills
 * one read per 1000 index entries it scans, so a tenant with 4000 payments
 * costs 4 reads here and 4000 if you fetched the documents and summed them
 * in JS. Downloading whole payment collections to compute a total is
 * precisely what exhausted the daily read quota once already
 * (`docs/decisions-and-gotchas.md`) - don't reintroduce it.
 *
 * The cost still scales with tenant *count*, so this is deliberately not
 * called from an API route the client can poll. Page-level only, behind the
 * 60s cache in `lib/stats-cache.ts`.
 */
export async function getTenantEarnings(
  tenantIds: string[]
): Promise<Record<string, TenantEarnings>> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const results: Record<string, TenantEarnings> = {};

  for (let i = 0; i < tenantIds.length; i += EARNINGS_CONCURRENCY) {
    const batch = tenantIds.slice(i, i + EARNINGS_CONCURRENCY);

    await Promise.all(
      batch.map(async (tenantId) => {
        // Two aggregations, run together, so the batch of eight still
        // finishes in one round-trip. The cash one filters on the field
        // itself: `!= null` matches only documents that have it, which
        // counts generated sales without querying on `source`.
        const [snapshot, cash] = await Promise.all([
          adminDb
            .collection(TENANT_COLLECTIONS.payments(tenantId))
            .where("status", "==", "success")
            .aggregate({
              count: AggregateField.count(),
              gross: AggregateField.sum("amount"),
              platformShare: AggregateField.sum("platformShareKobo"),
            })
            .get(),
          adminDb
            .collection(TENANT_COLLECTIONS.vouchers(tenantId))
            .where("cashSaleKobo", "!=", null)
            .aggregate({
              count: AggregateField.count(),
              total: AggregateField.sum("cashSaleKobo"),
            })
            .get(),
        ]);

        const data = snapshot.data();
        results[tenantId] = {
          grossKobo: data.gross ?? 0,
          platformShareKobo: data.platformShare ?? 0,
          paymentCount: data.count ?? 0,
          cashSalesKobo: cash.data().total ?? 0,
          cashSaleCount: cash.data().count ?? 0,
        };
      })
    );
  }

  return results;
}
