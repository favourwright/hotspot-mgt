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
export const LocationSchema = z.object({
  id: z.string(),
  name: z.string().min(2),
  routerIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
  active: z.boolean(),
  wireguardPublicKey: z.string().nullable().optional(),
  wireguardTunnelIp: z.string().nullable().optional(),
  connectionMethod: z.enum(["wireguard", "direct"]).default("direct"),
  createdAt: z.date(),
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
  "www",
  "app",
  "mail",
  "static",
  "assets",
];

// Tenant Billing Plan Schema
export const TenantBillingPlanSchema = z.enum([
  "pay-per-transaction",
  "subscription-only",
  "hybrid",
]);

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
  // Billing plan
  billingPlan: TenantBillingPlanSchema,
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
  billingPlan: TenantBillingPlanSchema,
  accountNumber: z
    .string()
    .min(10, "Account number must be 10 digits")
    .max(10, "Account number must be 10 digits")
    .regex(/^\d+$/, "Account number must contain only digits"),
  bankCode: z.string().min(3, "Bank code is required"),
  bankName: z.string().min(2, "Bank name is required"),
  accountName: z.string().min(2, "Account name is required"),
});

// Platform Configuration Schemas
export const BillingPlanConfigItemSchema = z.object({
  monthlyFee: z.number().int().nonnegative(),
  platformFeePercent: z.number().int().min(0).max(100),
  label: z.string(),
  description: z.string(),
});

export const PlatformConfigSchema = z.object({
  billingPlans: z.object({
    "pay-per-transaction": BillingPlanConfigItemSchema,
    "subscription-only": BillingPlanConfigItemSchema,
    hybrid: BillingPlanConfigItemSchema,
  }),
  paystackBearer: z
    .enum([
      "account",    // tenant bears Paystack fees
      "subaccount", // platform bears Paystack fees
    ])
    .default("account"),
  wireguard: z.object({
    serverPublicKey: z.string().default(""),
    serverEndpoint: z.string().default(""),
    tunnelSubnet: z.string().default("10.10.0.0/16"),
  }),
  updatedAt: z.date().optional(),
});

// Billing Plan Configuration (Default/Fallback)
export const DEFAULT_BILLING_PLAN_CONFIG: Record<
  TenantBillingPlan,
  z.infer<typeof BillingPlanConfigItemSchema>
> = {
  "pay-per-transaction": {
    monthlyFee: 0,
    platformFeePercent: 8,
    label: "Pay Per Transaction",
    description: "No monthly fee. We take 8% of each voucher sale.",
  },
  "subscription-only": {
    monthlyFee: 300000,
    platformFeePercent: 0,
    label: "Subscription Only",
    description: "₦3,000/month flat fee. Keep 100% of voucher sales.",
  },
  hybrid: {
    monthlyFee: 150000,
    platformFeePercent: 3,
    label: "Hybrid",
    description: "₦1,500/month + 3% per transaction.",
  },
} as const;

// Backward compatibility alias
export const BILLING_PLAN_CONFIG = DEFAULT_BILLING_PLAN_CONFIG;

// Infer TypeScript types from schemas
export type User = z.infer<typeof UserSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Voucher = z.infer<typeof VoucherSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type MikrotikHotspotUser = z.infer<typeof MikrotikHotspotUserSchema>;
export type MikrotikProfile = z.infer<typeof MikrotikProfileSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantCustomer = z.infer<typeof TenantCustomerSchema>;
export type TenantBillingPlan = z.infer<typeof TenantBillingPlanSchema>;
export type TenantStatus = z.infer<typeof TenantStatusSchema>;
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type BillingPlanConfigItem = z.infer<typeof BillingPlanConfigItemSchema>;
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: string;
};
