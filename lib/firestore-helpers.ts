import { DocumentSnapshot, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import {
  UserSchema,
  LocationSchema,
  RouterSchema,
  PlanSchema,
  VoucherSchema,
  PaymentSchema,
  TenantSchema,
  TenantCustomerSchema,
  User,
  Location,
  Router,
  Plan,
  Voucher,
  Payment,
  Tenant,
  TenantCustomer,
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
  status?: "active" | "expired" | "failed"
): Promise<Voucher[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  let query = adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .orderBy("createdAt", "desc");

  if (status) {
    query = query.where("status", "==", status) as FirebaseFirestore.Query;
  }

  const snapshot = await query.get();
  return parseVouchers(snapshot.docs);
}

/**
 * Fetch all payments for a tenant
 */
export async function getTenantPayments(tenantId: string): Promise<Payment[]> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.payments(tenantId))
    .orderBy("createdAt", "desc")
    .get();

  return parsePayments(snapshot.docs);
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
 * Count of distinct customers a tenant has — used against a plan's
 * limits.maxCustomers. Uses a Firestore count() aggregation query rather
 * than reading every customer document.
 */
export async function getTenantCustomerCount(tenantId: string): Promise<number> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const snapshot = await adminDb
    .collection(TENANT_COLLECTIONS.customers(tenantId))
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
  totalRevenue: number;
  totalVouchers: number;
  activeVouchers: number;
  failedVouchers: number;
  todayRevenue: number;
  todayVouchers: number;
}> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const { TENANT_COLLECTIONS } = await import("@/lib/firebase-collections");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    paymentsSnapshot,
    vouchersSnapshot,
    activeSnapshot,
    failedSnapshot,
    todayPaymentsSnapshot,
    todayVouchersSnapshot,
  ] = await Promise.all([
    adminDb
      .collection(TENANT_COLLECTIONS.payments(tenantId))
      .where("status", "==", "success")
      .get(),
    adminDb.collection(TENANT_COLLECTIONS.vouchers(tenantId)).get(),
    adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("status", "==", "active")
      .get(),
    adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("status", "==", "failed")
      .get(),
    adminDb
      .collection(TENANT_COLLECTIONS.payments(tenantId))
      .where("status", "==", "success")
      .where("createdAt", ">=", today)
      .get(),
    adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("createdAt", ">=", today)
      .get(),
  ]);

  const totalRevenue = paymentsSnapshot.docs.reduce(
    (sum, doc) => sum + (doc.data().amount || 0),
    0
  );

  const todayRevenue = todayPaymentsSnapshot.docs.reduce(
    (sum, doc) => sum + (doc.data().amount || 0),
    0
  );

  return {
    totalRevenue,
    totalVouchers: vouchersSnapshot.size,
    activeVouchers: activeSnapshot.size,
    failedVouchers: failedSnapshot.size,
    todayRevenue,
    todayVouchers: todayVouchersSnapshot.size,
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    allTenantsSnapshot,
    activeTenantsSnapshot,
    suspendedTenantsSnapshot,
    pendingTenantsSnapshot,
  ] = await Promise.all([
    adminDb.collection(COLLECTIONS.TENANTS).get(),
    adminDb
      .collection(COLLECTIONS.TENANTS)
      .where("status", "==", "active")
      .get(),
    adminDb
      .collection(COLLECTIONS.TENANTS)
      .where("status", "==", "suspended")
      .get(),
    adminDb
      .collection(COLLECTIONS.TENANTS)
      .where("status", "==", "pending")
      .get(),
  ]);

  // Calculate MRR from active subscription tenants
  const activeTenants = parseTenants(activeTenantsSnapshot.docs);
  const mrr = activeTenants.reduce((sum, tenant) => {
    return sum + (tenant.monthlyFee || 0);
  }, 0);

  // For total vouchers and revenue, use collectionGroup queries
  const [vouchersSnapshot, paymentsSnapshot, todayPaymentsSnapshot] =
    await Promise.all([
      adminDb
        .collectionGroup("vouchers")
        .where("status", "==", "active")
        .get(),
      adminDb.collectionGroup("payments").where("status", "==", "success").get(),
      adminDb
        .collectionGroup("payments")
        .where("status", "==", "success")
        .where("createdAt", ">=", today)
        .get(),
    ]);

  const totalRevenue = paymentsSnapshot.docs.reduce(
    (sum, doc) => sum + (doc.data().platformShareKobo || 0),
    0
  );

  const todayRevenue = todayPaymentsSnapshot.docs.reduce(
    (sum, doc) => sum + (doc.data().platformShareKobo || 0),
    0
  );

  return {
    totalTenants: allTenantsSnapshot.size,
    activeTenants: activeTenantsSnapshot.size,
    suspendedTenants: suspendedTenantsSnapshot.size,
    pendingTenants: pendingTenantsSnapshot.size,
    totalVouchersAllTenants: vouchersSnapshot.size,
    totalRevenueAllTenants: totalRevenue,
    todayRevenueAllTenants: todayRevenue,
    mrr,
  };
}
