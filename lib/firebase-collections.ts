// Top-level collections
export const COLLECTIONS = {
  USERS: "users",
  TENANTS: "tenants",
  PLATFORM: "platform",
  BILLING_PLANS: "billingPlans",
  // Mailtrap template IDs per email type. Deliberately NOT under `platform`:
  // that collection is world-readable by Firestore rule, and nothing on the
  // client ever needs this.
  EMAIL_CONFIG: "emailConfig",
  // Addon catalog. Publicly readable like billingPlans: it is a price list,
  // and the onboarding and admin pages both render it.
  ADDONS: "addons",
  // Paystack subscription code -> what it pays for. Server-side only, and
  // the reason an addon subscription cannot be mistaken for the tenant's
  // platform subscription. See types/schemas.ts SubscriptionIndexSchema.
  SUBSCRIPTION_INDEX: "subscriptionIndex",
  // One document per Paystack reference already redeemed for an addon,
  // created with `create()` so the claim is atomic. This is what stops a
  // reference being presented twice, or by a second tenant.
  ADDON_PAYMENTS: "addonPayments",
  // Paystack references the reconciliation job must never fulfil: refunds,
  // chargebacks, test charges, anything already settled off-platform. One
  // document per reference, written by a human decision, not by code.
  RECONCILE_SKIPS: "reconcileSkips",
  // One ledger per voucher sale, keyed by the Paystack reference: what
  // fulfilment decided to do and how far it got, so a sale interrupted
  // partway is resumed rather than reported as done. Holds the voucher
  // password, so server-side only. See lib/fulfilment-runner.ts.
  FULFILMENTS: "fulfilments",
  // Charges that cleared and could not be honoured automatically (plan
  // switched off mid-checkout, amount mismatch, router gone). One document
  // per reference, for a human to resolve. Server-side only.
  PAYMENT_REVIEWS: "paymentReviews",
  // Promo codes, keyed by the normalised code so redemption is a
  // get-by-id. Server-written only: a client able to write here mints
  // themselves free months.
  COUPONS: "coupons",
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
  // A customer's chosen voucher username and password at this tenant, one
  // document per uid. Deliberately not a field on the customer document:
  // that one is created by a purchase and is what maxCustomers counts, so
  // writing it for somebody who has only opened their profile page would
  // spend a seat the tenant pays for. See types/schemas.ts.
  voucherCredentials: (tenantId: string) =>
    `tenants/${tenantId}/voucherCredentials`,
  // Server-written only. A tenant granting themselves one of these would be
  // the whole paywall, so no Firestore rule ever opens it to the client.
  entitlements: (tenantId: string) => `tenants/${tenantId}/entitlements`,
  // Server-written only, for the same reason as entitlements: a tenant who
  // could write one of these would be waiving their own bill.
  feeWaivers: (tenantId: string) => `tenants/${tenantId}/feeWaivers`,
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
