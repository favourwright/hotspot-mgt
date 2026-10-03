import { z } from "zod";

/**
 * Zod schemas are the single source of truth for all data types.
 * TypeScript types are automatically inferred from these schemas.
 * 
 * Benefits:
 * - Change schema once, types update everywhere
 * - Runtime validation catches data corruption
 * - Self-documenting
 * - Used for both API input validation and Firestore reads
 */

// User Schema
export const UserSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  role: z.enum(["superadmin", "owner", "customer"]),
  tenantId: z.string().nullable().default(null),
  createdAt: z.date(),
});

// Location (MikroTik Router) Schema
// Phase 3: Locations no longer store credentials directly.
// They reference a router via routerId, and router credentials
// are fetched from the routers collection when needed.
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  routerId: z.string().min(1, "Router is required"),
  active: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date().optional(),
});

// Router Schema
export const RouterSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  connectionMethod: z.enum(["wireguard", "direct"]),
  routerIp: z.string(),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
  wireguardPublicKey: z.string().nullable().default(null),
  wireguardTunnelIp: z.string().nullable().default(null),
  // Per-registration-attempt generated identity (e.g. "wg-hm-a3f9k2") - never
  // hardcoded, so a fresh attempt can never collide with a tenant's own
  // pre-existing WireGuard config. Stored purely for support reference.
  wireguardInterfaceName: z.string().nullable().default(null),
  wireguardListenPort: z.number().int().nullable().default(null),
  status: z.enum(["pending", "online", "offline"]),
  active: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Plan Schema
export const PlanSchema = z.object({
  id: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  name: z.string().min(1),
  price: z.number().int().positive(), // price in kobo
  duration: z.string(),
  routerDurationValue: z.number().int().min(1),
  routerDurationUnit: z.enum(["h", "d"]),
  dataLimit: z.string().nullable().optional(),
  mikrotikProfile: z.string().min(1),
  active: z.boolean(),
  sameCredentials: z.boolean().optional().default(true), // whether username and password should be the same
  createdAt: z.date(),
});

// Voucher Schema
export const VoucherSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().email(),
  planId: z.string(),
  planName: z.string(),
  locationId: z.string(),
  locationName: z.string(),
  tenantId: z.string().optional(),
  username: z.string(),
  password: z.string(),
  duration: z.string(),
  dataLimit: z.string().optional(),
  status: z.enum(["active", "expired", "failed"]),
  paystackReference: z.string().default(""), // Made optional with default
  failureReason: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0), // Made optional with default
  lastRetryAt: z.date().optional().nullable(),
  createdAt: z.date(),
  expiresAt: z.date().nullable().default(null), // Made nullable with default
});

// Payment Schema
export const PaymentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string().email(),
  planId: z.string(),
  planName: z.string(),
  locationId: z.string(),
  tenantId: z.string(),
  amount: z.number().int().positive(), // amount in kobo
  paystackReference: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  voucherId: z.string().optional(),
  subaccountCode: z.string().nullable().optional(),
  platformShareKobo: z.number().int().optional(),
  tenantShareKobo: z.number().int().optional(),
  createdAt: z.date(),
});

// MikroTik Hotspot User Schema
export const MikrotikHotspotUserSchema = z.object({
  name: z.string(),
  password: z.string(),
  profile: z.string(),
  comment: z.string().optional(),
});

// MikroTik Hotspot Profile Schema
export const MikrotikProfileSchema = z.object({
  ".id": z.string(),
  name: z.string(),
  "rate-limit": z.string().optional(),
  "session-timeout": z.string().optional(),
  "shared-users": z.string().optional(),
  "keepalive-timeout": z.string().optional(),
  "status-autorefresh": z.string().optional(),
  "idle-timeout": z.string().optional(),
  "transparent-proxy": z.string().optional(),
});

// API Response Schema
export const ApiResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.boolean(),
    data: dataSchema.optional(),
    error: z.string().optional(),
  });

// Reserved slugs for tenant registration
const RESERVED_SLUGS = [
  "admin",
  "api",
  "auth",
  "login",
  "register",
  "dashboard",
  "superadmin",
  "billing",
  "settings",
  "support",
  "help",
  "faq",
  "www",
  "app",
  "mail",
  "static",
  "assets",
];

// Billing Plan (platform subscription tier) Schema - superadmin-managed, full
// CRUD. Distinct from PlanSchema above, which is a tenant's own hotspot
// voucher plan (price/duration/MikroTik profile) - unrelated concept, same
// word used in two different parts of this app, so always say "BillingPlan"
// for this one to avoid confusion.
export const BillingModelSchema = z.enum(["flat", "usage", "hybrid", "free", "custom"]);

export const BillingPlanLimitsSchema = z.object({
  maxLocations: z.number().int().positive().nullable().default(null),
  maxRouters: z.number().int().positive().nullable().default(null),
  maxCustomers: z.number().int().positive().nullable().default(null),
});

export const BillingPlanFeaturesSchema = z.object({
  customBranding: z.boolean().default(false),
  apiAccess: z.boolean().default(false),
  prioritySupport: z.boolean().default(false),
});

export const BillingPlanSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  billingModel: BillingModelSchema,
  monthlyFee: z.number().int().nonnegative().default(0), // kobo
  platformFeePercent: z.number().min(0).max(100).default(0),
  transactionFeeFlat: z.number().int().nonnegative().default(0), // kobo, flat fee per sale
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  trialDays: z.number().int().nonnegative().default(0),
  limits: BillingPlanLimitsSchema.default({
    maxLocations: null,
    maxRouters: null,
    maxCustomers: null,
  }),
  features: BillingPlanFeaturesSchema.default({
    customBranding: false,
    apiAccess: false,
    prioritySupport: false,
  }),
  featureList: z.array(z.string()).default([]), // marketing bullets for onboarding card
  badge: z.string().nullable().default(null), // e.g. "Most Popular"
  // Only meaningful when billingModel is "custom" - a mailto: address or URL
  // the onboarding card's "Contact Us" action links to. Null renders as
  // plain text with no link. Irrelevant (but harmless) on any other model.
  contactUrl: z.string().nullable().default(null),
  active: z.boolean().default(true), // selectable by new tenants
  sortOrder: z.number().int().default(0),
  // Cached Paystack Plan code, same drift-detection pattern as before.
  paystackPlanCode: z.string().nullable().default(null),
  paystackPlanAmount: z.number().int().nonnegative().nullable().default(null),
  // A SEPARATE cached Paystack Plan - amount includes the estimated Paystack
  // processing fee (see lib/paystack-fees.ts) - used only for brand-new
  // onboarding signups when PlatformConfig.paystackFeePassthrough is on.
  // Deliberately never the same Plan object as paystackPlanCode above: an
  // existing tenant's live Paystack Subscription already points at that one,
  // and Paystack's own "update plan amount" semantics around whether that
  // retroactively affects existing subscribers are not reliably documented -
  // so this never touches that object at all, regardless.
  paystackPlanCodeWithFee: z.string().nullable().default(null),
  paystackPlanAmountWithFee: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable().default(null), // soft-delete only, never a real delete
});

// Input schemas for the superadmin billing-plan API. Create requires
// name/billingModel (no default on either in the base schema above); every
// other field already has its own .default(), so it's optional at the top
// level naturally. Update makes everything optional, for partial PATCH.
export const CreateBillingPlanInputSchema = BillingPlanSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});
export const UpdateBillingPlanInputSchema = CreateBillingPlanInputSchema.partial();

// Tenant Status Schema
export const TenantStatusSchema = z.enum([
  "pending",
  "active",
  "suspended",
  "cancelled",
]);

// Tenant Schema
export const TenantSchema = z.object({
  id: z.string(),
  // Identity
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(30, "Slug must be at most 30 characters")
    .regex(
      /^[a-z0-9-]+$/,
      "Slug can only contain lowercase letters, numbers and hyphens"
    ),
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  ownerUid: z.string(),
  ownerEmail: z.string().email(),
  // Account status
  status: TenantStatusSchema,
  // Billing plan - references a BillingPlan doc. platformFeePercent/monthlyFee
  // below are snapshotted at signup (price is locked in); limits are instead
  // read live from the referenced plan at enforcement time (see lib/billing-plans.ts).
  planId: z.string(),
  planName: z.string().default(""), // denormalized display name, same pattern as Voucher.planName
  platformFeePercent: z.number().int().min(0).max(100),
  monthlyFee: z.number().int().nonnegative(),
  // Paystack subscription (null if pay-per-transaction)
  paystackCustomerCode: z.string().nullable().default(null),
  paystackSubscriptionCode: z.string().nullable().default(null),
  subscriptionStatus: z
    .enum(["pending", "active", "past_due", "cancelled"])
    .nullable()
    .default(null),
  nextBillingDate: z.date().nullable().default(null),
  // Paystack subaccount
  paystackSubaccountCode: z.string().nullable().default(null),
  bankName: z.string().nullable().default(null),
  accountNumber: z.string().nullable().default(null),
  accountName: z.string().nullable().default(null),
  // WireGuard
  wireguardPublicKey: z.string().nullable().default(null),
  wireguardTunnelIp: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Tenant Customer Schema
export const TenantCustomerSchema = z.object({
  uid: z.string(),
  email: z.string().email(),
  totalVouchers: z.number().int().nonnegative().default(0),
  totalSpent: z.number().int().nonnegative().default(0),
  joinedAt: z.date(),
});

// Slug Validation Schema
export const SlugSchema = z
  .string()
  .min(3, "Slug must be at least 3 characters")
  .max(30, "Slug must be at most 30 characters")
  .regex(
    /^[a-z0-9-]+$/,
    "Slug can only contain lowercase letters, numbers and hyphens"
  )
  .refine(
    (slug) => !RESERVED_SLUGS.includes(slug),
    "This slug is reserved and cannot be used"
  );

// Tenant Onboarding Input Schema
export const CreateTenantSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters"),
  slug: SlugSchema,
  planId: z.string().min(1, "A billing plan must be selected"),
  accountNumber: z
    .string()
    .min(10, "Account number must be 10 digits")
    .max(10, "Account number must be 10 digits")
    .regex(/^\d+$/, "Account number must contain only digits"),
  bankCode: z.string().min(3, "Bank code is required"),
  bankName: z.string().min(2, "Bank name is required"),
  accountName: z.string().min(2, "Account name is required"),
  // Required only when the selected billing plan has a monthlyFee > 0 -
  // the reference from the Paystack Inline charge collected in onboarding Step 4.
  paystackReference: z.string().optional(),
});

// Platform Configuration Schemas
export const PlatformConfigSchema = z.object({
  // Paystack's own `bearer` parameter on a split transaction, passed straight
  // through unmodified (see CheckoutDialog) - "account" means the platform's
  // own main Paystack account absorbs Paystack's processing fee, "subaccount"
  // means the tenant's subaccount absorbs it. No UI currently exposes this
  // for editing; it has always run at its default ("account").
  paystackBearer: z
    .enum([
      "account",
      "subaccount",
    ])
    .default("account"),
  wireguard: z.object({
    serverPublicKey: z.string().default(""),
    serverEndpoint: z.string().default(""),
    tunnelSubnet: z.string().default("10.10.0.0/16"),
  }),
  // Makes the PAYER (the customer buying a voucher, or the tenant paying
  // their own subscription) cover Paystack's processing fee on top of the
  // listed price, instead of it being deducted from the platform's/tenant's
  // settlement - see lib/paystack-fees.ts and docs/billing-and-payments.md.
  // Starts disabled: a brand-new, money-affecting feature should never
  // silently change production charging behavior the moment it ships.
  paystackFeePassthrough: z
    .object({
      enabled: z.boolean().default(false),
      // Paystack's published local-card rate as of writing: 1.5% + ₦100,
      // capped at ₦2,000, with the ₦100 waived entirely at/under ₦2,500.
      // These are estimates, not a live Paystack fee lookup (no such API
      // exists) - any gap between the estimate and Paystack's real fee is
      // absorbed entirely by the platform's own margin, never by the
      // tenant's payout. See the transaction_charge-based split in
      // lib/paystack-fees.ts for exactly how that guarantee is kept.
      percent: z.number().min(0).max(100).default(1.5),
      flatFeeKobo: z.number().int().nonnegative().default(10000),
      capKobo: z.number().int().nonnegative().default(200000),
      waiveFlatFeeBelowKobo: z.number().int().nonnegative().default(250000),
    })
    .default({
      enabled: false,
      percent: 1.5,
      flatFeeKobo: 10000,
      capKobo: 200000,
      waiveFlatFeeBelowKobo: 250000,
    }),
  updatedAt: z.date().optional(),
});

// Infer TypeScript types from schemas
export type User = z.infer<typeof UserSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Router = z.infer<typeof RouterSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Voucher = z.infer<typeof VoucherSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type MikrotikHotspotUser = z.infer<typeof MikrotikHotspotUserSchema>;
export type MikrotikProfile = z.infer<typeof MikrotikProfileSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantCustomer = z.infer<typeof TenantCustomerSchema>;
export type TenantStatus = z.infer<typeof TenantStatusSchema>;
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type BillingModel = z.infer<typeof BillingModelSchema>;
export type BillingPlan = z.infer<typeof BillingPlanSchema>;
export type BillingPlanLimits = z.infer<typeof BillingPlanLimitsSchema>;
export type BillingPlanFeatures = z.infer<typeof BillingPlanFeaturesSchema>;
export type CreateBillingPlanInput = z.infer<typeof CreateBillingPlanInputSchema>;
export type UpdateBillingPlanInput = z.infer<typeof UpdateBillingPlanInputSchema>;
export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
