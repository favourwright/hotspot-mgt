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
  // Captive portal state, written by the install/uninstall endpoints.
  // Null on every location that predates the feature, which is also how
  // "not installed" is represented.
  portalInstalledAt: z.date().nullable().optional(),
  portalHtmlDirectory: z.string().nullable().optional(),
  /**
   * What each hotspot server profile pointed at before we installed, so
   * uninstall can put every one of them back on its own directory rather
   * than flattening them all onto one. Null on locations installed before
   * this was recorded, which fall back to portalPreviousHtmlDirectory.
   */
  portalPreviousProfiles: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        htmlDirectory: z.string(),
        /**
         * The profile's authentication methods before install. Absent on
         * captures made before the portal started enabling `http-pap`,
         * which is why uninstall only restores it when it is present.
         */
        loginBy: z.string().optional(),
      })
    )
    .nullable()
    .optional(),
  /** Legacy single-directory capture. Superseded by portalPreviousProfiles. */
  portalPreviousHtmlDirectory: z.string().nullable().optional(),
  /** Whether this router accepts server-side MAC login; null until probed. */
  macLoginSupported: z.boolean().nullable().optional(),
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
  /**
   * How many devices one voucher can be signed in on at once: a mirror of the
   * MikroTik profile's `shared-users`, copied here at save time so the
   * storefront and the portal can show it without reaching the router on
   * every page view. A number as a string, or "unlimited".
   *
   * Absent on plans created before it was captured. Render nothing in that
   * case - the router is the authority and we have not asked it, so claiming
   * "1 device" would be a guess the customer pays for.
   */
  sharedUsers: z.string().nullable().optional(),
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
  /** Snapshot of the plan's `sharedUsers` at purchase, like `dataLimit`. */
  sharedUsers: z.string().nullable().optional(),
  /**
   * The MAC the voucher was bought on, when it came through the captive
   * portal. Null for a purchase made from the ordinary storefront, where
   * there's no device to attribute it to.
   *
   * This is what lets the portal greet a returning customer, and what makes
   * server-side auto-login possible: the webhook knows which device to log
   * in without the browser telling it.
   */
  deviceMac: z.string().nullable().optional(),
  status: z.enum(["active", "expired", "failed"]),
  /**
   * Set when an owner dismisses a voucher from the hotspot-users
   * reconciliation view -- a record the router no longer has and never will,
   * usually because the user was removed by hand long ago.
   *
   * Deliberately a flag rather than a delete. The voucher counts on every
   * dashboard are live `count()` queries over this collection, the matching
   * payment carries its `voucherId`, and the customer can still read their
   * own vouchers -- so removing the document would quietly rewrite how much
   * the tenant has ever sold and strand both of those references. Archiving
   * hides the row and leaves all of that intact, and can be undone.
   */
  archivedAt: z.date().nullable().optional(),
  paystackReference: z.string().default(""), // Made optional with default
  failureReason: z.string().optional(),
  retryCount: z.number().int().nonnegative().default(0), // Made optional with default
  lastRetryAt: z.date().optional().nullable(),
  createdAt: z.date(),
  /**
   * When the voucher actually runs out. Null until the customer logs in for
   * the first time, because that is the moment the clock starts: the
   * profile's on-login script on the router computes `now + duration` and
   * writes it into the user's comment (lib/mikrotik.ts,
   * pushProfileOnLoginScript). Purchase time tells you nothing, since a
   * voucher bought at 9am and first used at 5pm expires eight hours later.
   *
   * Filled from two places, neither of which guesses: the auto-login in
   * /api/payment/verify, which IS the first login for a portal purchase, and
   * the router-health cron job, which reads the comment back off the router
   * for anything the first path missed.
   */
  expiresAt: z.date().nullable().default(null),
  /**
   * When the "expiring soon" reminder was sent, so the cron job sends it once
   * rather than on every tick for the whole warning window.
   */
  expiryNotifiedAt: z.date().nullable().optional(),
  /**
   * When the voucher-expiry cron closed this out. Distinct from `expiresAt`,
   * which is when it was *due* to end: the gap between the two is how late
   * the job was, and without it an expired voucher carries no record of when
   * anyone actually noticed.
   */
  expiredAt: z.date().nullable().optional(),
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
  // Nullable, not just optional: null means Paystack reported no split for
  // a charge that named a subaccount, which is "unknown" and must stay
  // distinguishable from a real zero.
  platformShareKobo: z.number().int().nullable().optional(),
  tenantShareKobo: z.number().int().nullable().optional(),
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
// Every entry here becomes `<slug>.ogawifi.online`, so this list guards two
// things at once: a platform route a tenant could shadow, and a hostname
// that already resolves somewhere else. The email names are live DNS --
// Namecheap Private Email -- and handing one to a tenant would break mail.
const RESERVED_SLUGS = [
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "autoconfig",
  "autodiscover",
  "billing",
  "cdn",
  "dashboard",
  "email",
  "faq",
  "help",
  "login",
  "mail",
  "onboarding",
  "portal",
  "register",
  "settings",
  "static",
  "status",
  "superadmin",
  "support",
  "www",
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
  /**
   * Who absorbs Paystack's own processing fee on this plan's voucher sales,
   * passed straight through as Paystack Inline's `bearer`. `subaccount` puts
   * it on the tenant, `account` on the platform.
   *
   * Null means inherit `PlatformConfig.paystackBearer`, and is the default so
   * that adding this field changed nothing for existing plans. The dialog
   * only ever writes `subaccount` or null, since forcing `account` against a
   * platform default of `account` would be a no-op; the enum keeps the third
   * state available for when that default is something else.
   */
  paystackBearer: z.enum(["account", "subaccount"]).nullable().default(null),
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
  /**
   * Addon keys this plan grants outright, so a tier can bundle features a
   * tenant would otherwise buy separately. Resolution is "granted by my
   * plan OR separately purchased" (lib/entitlements.ts), never one or the
   * other, so removing a key here only withdraws the free grant - it never
   * revokes an addon a tenant actually paid for.
   */
  includedAddons: z.array(z.string()).default([]),
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
  /**
   * Optional emails this owner has switched off for themselves, by catalog
   * key. A *mute* list rather than a map of every key: an absent entry means
   * send, so a newly added email is on for every existing tenant with no
   * migration, and a half-written field degrades into too much mail rather
   * than silence. Only keys flagged `optional` in lib/email-catalog.ts have
   * any effect - see lib/notification-prefs.ts.
   */
  emailOptOuts: z.array(z.string()).default([]),
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
// Email Template Config Schema
//
// Which Mailtrap template each of this app's emails maps onto. The set of
// emails itself is declared in code (lib/email-catalog.ts) and is never
// stored - this holds only the parts a superadmin can change. One Firestore
// document holds every entry, so a send costs one read rather than one per
// email type.
export const EmailTemplateSettingSchema = z.object({
  // Mailtrap's template UUID. Empty means "not configured yet", which is a
  // real state: an email with no template is skipped rather than sent blank.
  templateId: z.string().trim().default(""),
  // Lets a superadmin mute one email without clearing the template ID they
  // already found and pasted in.
  enabled: z.boolean().default(true),
  updatedAt: z.date().nullable().default(null),
});

// Email settings: who receives operational alerts, and the support address
// shown to users. Both used to be a single env var (PLATFORM_ALERT_EMAIL),
// which meant changing either one needed a deploy and a restart.
export const EmailSettingsSchema = z.object({
  // Every address that gets platform.* alerts. Sent as one message with
  // several recipients rather than one message each: these are internal
  // operational alerts, so the recipients already know about each other.
  alertRecipients: z.array(z.string().email()).default([]),
  // The address user-facing templates show as the way to reach a human. Kept
  // separate from alertRecipients on purpose: the inbox that should receive a
  // split-mismatch alert is rarely the one a customer should be emailing.
  supportEmail: z.string().email().or(z.literal("")).default(""),
  updatedAt: z.date().nullable().default(null),
});

export const EmailTemplateConfigSchema = z.object({
  templates: z.record(z.string(), EmailTemplateSettingSchema).default({}),
  updatedAt: z.date().nullable().default(null),
});

export type Voucher = z.infer<typeof VoucherSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type MikrotikHotspotUser = z.infer<typeof MikrotikHotspotUserSchema>;
export type MikrotikProfile = z.infer<typeof MikrotikProfileSchema>;
export type Tenant = z.infer<typeof TenantSchema>;
export type TenantCustomer = z.infer<typeof TenantCustomerSchema>;
export type TenantStatus = z.infer<typeof TenantStatusSchema>;
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type EmailTemplateSetting = z.infer<typeof EmailTemplateSettingSchema>;
export type EmailTemplateConfig = z.infer<typeof EmailTemplateConfigSchema>;
export type EmailSettings = z.infer<typeof EmailSettingsSchema>;
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


// ─── Addons ──────────────────────────────────────────────────────────────

/**
 * How an addon is paid for.
 *
 * `free` is a real option rather than an amount of 0: it means the addon is
 * on for every tenant without an entitlement document existing at all, which
 * keeps "turn this on for everyone" a one-field change rather than a
 * backfill across every tenant.
 */
export const AddonPricingModelSchema = z.enum([
  "free",
  "one_time",
  "subscription",
]);
export type AddonPricingModel = z.infer<typeof AddonPricingModelSchema>;

export const AddonSchema = z.object({
  /** Doc id, and the key gates are written against. See lib/addon-catalog.ts. */
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  pricingModel: AddonPricingModelSchema,
  /** Kobo. Always 0 when pricingModel is "free". */
  amount: z.number().int().nonnegative().default(0),
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  /**
   * Cached Paystack Plan code for subscription addons, with the same
   * drift-detection pattern as BillingPlan: if the cached amount no longer
   * matches `amount`, the Plan is updated on Paystack before use.
   */
  paystackPlanCode: z.string().nullable().default(null),
  paystackPlanAmount: z.number().int().nonnegative().nullable().default(null),
  /** Selectable by tenants. Turning this off never revokes existing grants. */
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Addon = z.infer<typeof AddonSchema>;

/**
 * What a superadmin may change about an addon.
 *
 * Note what is absent: the key. Addons are not created or deleted from the
 * UI, because an addon only does anything if a route calls
 * `requireAddon` with its key, and that is a code change. A key that no gate
 * references would be sellable and enforce nothing, which is the trap the
 * `customBranding` / `apiAccess` / `prioritySupport` flags already fell into
 * on this platform. lib/addon-catalog.ts is the list; this is its pricing.
 */
export const UpdateAddonInputSchema = AddonSchema.omit({
  key: true,
  createdAt: true,
  updatedAt: true,
  paystackPlanCode: true,
  paystackPlanAmount: true,
});
export type UpdateAddonInput = z.infer<typeof UpdateAddonInputSchema>;

/**
 * Where an entitlement stands.
 *
 * `past_due` is distinct from `expired` on purpose. Paystack retries a
 * failed invoice over several days and fires `invoice.payment_failed` on the
 * first attempt, not the last, so treating the first failure as the end of
 * the world would black out a venue's portal over a card that was going to
 * succeed on retry. `past_due` keeps access alive through the grace window
 * in lib/entitlements.ts; only `expired` and `cancelled` actually withdraw it.
 */
export const EntitlementStatusSchema = z.enum([
  "active",
  "past_due",
  "cancelled",
  "expired",
]);
export type EntitlementStatus = z.infer<typeof EntitlementStatusSchema>;

/**
 * A tenant's claim on one addon. Lives at
 * `tenants/{id}/entitlements/{addonKey}` and is written **only** by the
 * server, from payment facts. Never a boolean on the tenant document: that
 * document was owner-writable from the browser until recently, and a
 * self-grantable entitlement is not an entitlement.
 */
export const AddonEntitlementSchema = z.object({
  addonKey: z.string().min(1),
  /** "plan" grants are implicit and never stored; only purchases are. */
  source: z.literal("purchase"),
  status: EntitlementStatusSchema,
  pricingModel: AddonPricingModelSchema,
  /** The addon's own subscription, never the tenant's platform one. */
  paystackSubscriptionCode: z.string().nullable().default(null),
  paystackCustomerCode: z.string().nullable().default(null),
  /** Last verified transaction reference, for reconciliation. */
  lastPaymentRef: z.string().nullable().default(null),
  /** Kobo actually charged, so a later price change cannot rewrite history. */
  amountPaid: z.number().int().nonnegative().default(0),
  grantedAt: z.date(),
  /** Null for one-time purchases, which never expire. */
  currentPeriodEnd: z.date().nullable().default(null),
  /** When the first failed invoice arrived; drives the grace window. */
  pastDueSince: z.date().nullable().default(null),
  cancelledAt: z.date().nullable().default(null),
  updatedAt: z.date(),
});
export type AddonEntitlement = z.infer<typeof AddonEntitlementSchema>;

/**
 * Maps a Paystack subscription code to whatever it pays for.
 *
 * Exists because a tenant has exactly one Paystack customer code, shared by
 * their platform subscription and every addon subscription they buy. The
 * webhook used to resolve events by customer code alone, which meant an
 * addon's `subscription.create` would overwrite the tenant's
 * `paystackSubscriptionCode` and silently break platform billing. Routing on
 * the subscription code instead makes the target explicit.
 *
 * Keyed by subscription code so resolution is a single get-by-id rather than
 * a query, which also means it needs no composite index and cannot return
 * two matches.
 */
export const SubscriptionIndexSchema = z.object({
  subscriptionCode: z.string().min(1),
  kind: z.enum(["platform", "addon"]),
  tenantId: z.string().min(1),
  /** Set only when kind is "addon". */
  addonKey: z.string().nullable().default(null),
  createdAt: z.date(),
});
export type SubscriptionIndex = z.infer<typeof SubscriptionIndexSchema>;
