// Top-level collections
export const COLLECTIONS = {
  USERS: "users",
  TENANTS: "tenants",
  PLATFORM: "platform",
  // Flat collections (current - will be migrated in a
  // later step, kept for backward compatibility)
  LOCATIONS: "locations",
  PLANS: "plans",
  VOUCHERS: "vouchers",
  PAYMENTS: "payments",
} as const;

// Tenant subcollection path helpers
// These return the full Firestore path for tenant-scoped data
export const TENANT_COLLECTIONS = {
  routers: (tenantId: string) => `tenants/${tenantId}/routers`,
  locations: (tenantId: string) => `tenants/${tenantId}/locations`,
  plans: (tenantId: string) => `tenants/${tenantId}/plans`,
  vouchers: (tenantId: string) => `tenants/${tenantId}/vouchers`,
  payments: (tenantId: string) => `tenants/${tenantId}/payments`,
  customers: (tenantId: string) => `tenants/${tenantId}/customers`,
} as const;

// Helper to get a tenant subcollection reference
// Usage: adminDb.collection(TENANT_COLLECTIONS.plans(tenantId))
export type TenantCollectionKey = keyof typeof TENANT_COLLECTIONS;

// Legacy exports for backward compatibility
export const USERS_COLLECTION = COLLECTIONS.USERS;
export const LOCATIONS_COLLECTION = COLLECTIONS.LOCATIONS;
export const PLANS_COLLECTION = COLLECTIONS.PLANS;
export const VOUCHERS_COLLECTION = COLLECTIONS.VOUCHERS;
export const PAYMENTS_COLLECTION = COLLECTIONS.PAYMENTS;
