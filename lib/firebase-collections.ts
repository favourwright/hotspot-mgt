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
  // Payments to the platform (plan periods, addons, paid signups): lib/billing-charges.ts.
  BILLING_CHARGES: "billingCharges",
  // One entry per payment the platform keeps money from, written with the
  // record of that money: lib/platform-revenue.ts. Server-side only.
  PLATFORM_REVENUE: "platformRevenue",
  // Payment references the reconciliation job must never fulfil: refunds,
  // chargebacks, test charges, anything already settled off-platform. One
  // document per reference, written by a human decision, not by code.
  RECONCILE_SKIPS: "reconcileSkips",
  // One ledger per voucher sale, keyed by the payment reference: what
  // fulfilment decided to do and how far it got, so a sale interrupted
  // partway is resumed rather than reported as done. Holds the voucher
  // password, so server-side only. See lib/fulfilment-runner.ts.
  FULFILMENTS: "fulfilments",
  // Charges that cleared and could not be honoured automatically (plan
  // switched off mid-checkout, amount mismatch, router gone). One document
  // per reference, for a human to resolve. Server-side only.
  PAYMENT_REVIEWS: "paymentReviews",
  // What a buyer agreed to pay for, written by /api/purchase/initiate
  // before the charge exists. Fulfilment takes the amount,
  // plan and buyer from here, not from the charge. Server-side only: a
  // client able to write here could agree to any price it liked.
  PENDING_PURCHASES: "pendingPurchases",
  // One document per decision-hook call: outcome, status, latency, never
  // the tenant's raw response. Top-level rather than under the tenant so
  // the 30-day purge is one plain query; the hooks page reads by hookId.
  // Server-side only.
  HOOK_CALLS: "hookCalls",
  // One per "Verify with <business>" attempt: a single-use state binding
  // the signed-in customer to the tenant's signed answer. Server-side only.
  HOOK_LINK_STATES: "hookLinkStates",
  // Tenants' API keys for /api/v1, keyed by the key id embedded in the key.
  // Holds only a hash of the secret. Server-side only.
  API_KEYS: "apiKeys",
  // Outbound webhook events, one per fact (deterministic id), and one
  // delivery per endpoint per event with its own retry schedule. Both
  // server-side only, both purged after 30 days. See lib/webhooks.ts.
  // "Was this helpful?" on /developers: one counter document per docs
  // section, never one per click. Server-side only.
  DOCS_FEEDBACK: "docsFeedback",
  WEBHOOK_EVENTS: "webhookEvents",
  WEBHOOK_DELIVERIES: "webhookDeliveries",
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
  // that one is created by a purchase and having one exempts a buyer from
  // maxCustomers, so writing it for somebody who has only opened their
  // profile page would let them past a full tenant. See types/schemas.ts.
  voucherCredentials: (tenantId: string) =>
    `tenants/${tenantId}/voucherCredentials`,
  // Server-written only. A tenant granting themselves one of these would be
  // the whole paywall, so no Firestore rule ever opens it to the client.
  entitlements: (tenantId: string) => `tenants/${tenantId}/entitlements`,
  // A tenant's decision hooks (lib/decision-hooks.ts). Server-side only:
  // each holds an encrypted signing secret, and a writable URL is a way to
  // point our server at anything.
  hooks: (tenantId: string) => `tenants/${tenantId}/hooks`,
  // Where a tenant wants events sent (lib/webhooks.ts). Server-side only:
  // each holds an encrypted signing secret, and a writable URL would point
  // our server at anything.
  webhookEndpoints: (tenantId: string) => `tenants/${tenantId}/webhookEndpoints`,
  // Which of the tenant's own customers each of our customers is, as the
  // tenant vouched through account linking (lib/hook-links.ts). One per uid.
  // Server-side only: writable, it would let anyone claim to be a member.
  customerLinks: (tenantId: string) => `tenants/${tenantId}/customerLinks`,
  // Server-written only, for the same reason as entitlements: a tenant who
  // could write one of these would be waiving their own bill.
  feeWaivers: (tenantId: string) => `tenants/${tenantId}/feeWaivers`,
  // Voucher generation (docs/voucher-generation.md). All server-written only:
  // a batch holds every code's password, the index decides what the cron
  // activates, and a tenant who could write usage or credits would be
  // granting themselves quota.
  voucherBatches: (tenantId: string) => `tenants/${tenantId}/voucherBatches`,
  // One document per router: every unused generated code on it, username to
  // batch id. What router-health reads each tick to notice a first login.
  generatedCodeIndex: (tenantId: string) =>
    `tenants/${tenantId}/generatedCodeIndex`,
  // One document per billing cycle: how much of the plan's allowance is spent.
  generationUsage: (tenantId: string) => `tenants/${tenantId}/generationUsage`,
  // One document per meter (today only "voucher-generation"): the balance.
  credits: (tenantId: string) => `tenants/${tenantId}/credits`,
  // Every change to a credit balance, and why. Never edited or deleted.
  creditLedger: (tenantId: string) => `tenants/${tenantId}/creditLedger`,
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
