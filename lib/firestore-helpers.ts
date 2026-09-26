import { DocumentSnapshot, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import {
  UserSchema,
  LocationSchema,
  PlanSchema,
  VoucherSchema,
  PaymentSchema,
  TenantSchema,
  TenantCustomerSchema,
  User,
  Location,
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
