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
   * Which branding the router-rendered pages in this location's portal
   * directory were last written with, as `brandSyncKey` builds it
   * (lib/portal-brand-sync.ts). Absent until the first write, which is how
   * router-health knows a portal installed before branding existed still
   * needs its pages rewritten.
   */
  portalBrandSynced: z.string().nullable().optional(),
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
  // No routerUser or routerPass, on purpose. This is the read model, and pages hand
  // it to client components as props, which puts every field in the page source.
  // zod drops what is not listed. Reading a login is lib/router-credentials.ts.
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
/**
 * The shape of a tenant's generated voucher codes. Lengths below the
 * minimums are refused because a hotspot login has no rate limiting and no
 * lockout: a short code space is a guessable one. See lib/generated-codes.ts.
 */
export const GeneratedCodeFormatSchema = z
  .object({
    length: z.number().int().min(6, "Codes need at least 6 characters").max(12),
    charset: z.enum(["alnum", "digits", "letters"]),
    prefix: z
      .string()
      .max(4)
      .regex(/^[A-Z0-9]*$/, "Prefix can only use capital letters and digits"),
    passwordMode: z.enum(["same", "separate"]),
  })
  .refine((f) => f.charset !== "digits" || f.length >= 10, {
    message: "Digit-only codes need at least 10 digits",
    path: ["length"],
  });

export type GeneratedCodeFormat = z.infer<typeof GeneratedCodeFormatSchema>;

export const VoucherSchema = z.object({
  id: z.string(),
  /**
   * The buyer. Null only for a `source: "generated"` voucher, which nobody
   * bought through the platform: the tenant printed the code and sold it
   * offline, and the platform first learns of it when somebody logs in with
   * it. Every reader that emails, links or counts a customer has to handle
   * the null; see docs/voucher-generation.md for the list.
   */
  userId: z.string().nullable(),
  userEmail: z.string().email().nullable(),
  /**
   * How the credential came to exist. Absent on every voucher written before
   * generation shipped, which is why it defaults to "purchase": every one of
   * those was a sale. Never query on it - a missing field does not match
   * `== "purchase"` in Firestore - read it after the fetch instead.
   */
  source: z.enum(["purchase", "generated"]).default("purchase"),
  /** The `voucherBatches` document a generated voucher came from. */
  batchId: z.string().nullable().optional(),
  /**
   * What a generated code was sold for, in kobo: its plan's price when the
   * batch was generated. Set at first use, which is when a printed card
   * counts as sold. The tenant took the money in cash, so it is never in
   * `payments` and the platform has no share of it. Absent on every
   * purchased voucher, whose money is in `payments`: that absence is what
   * lets revenue sum this field without querying on `source`.
   */
  cashSaleKobo: z.number().int().nonnegative().nullable().optional(),
  /** When a generated code was printed, as opposed to first used (`createdAt`). */
  generatedAt: z.date().nullable().optional(),
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
  /**
   * `"superseded"` is a renewal's doing: the customer bought the same plan
   * again before this one ran out, so its remaining days and data were
   * carried onto a newer voucher sharing the same router credential, and
   * this document stops being the live one.
   *
   * It is a distinct status rather than an early `"expired"` because two
   * crons key off `"active"` and both would otherwise be wrong: the expiry
   * reminder would email "your access ends in an hour" about a plan that was
   * just topped up, and the close-out would mark it expired on a date that
   * no longer applies. Dashboards are right either way - `totalVouchers`
   * counts every sale including this one, and `activeVouchers` should count
   * the credential once, which is what dropping out of `"active"` achieves.
   */
  status: z.enum(["active", "expired", "failed", "superseded"]),
  /**
   * The voucher this one renewed, when it was bought as a top-up rather than
   * minted fresh. Both documents carry the same `username`.
   */
  renewalOf: z.string().nullable().optional(),
  /** The renewal that took over from this one. The inverse of `renewalOf`. */
  supersededBy: z.string().nullable().optional(),
  supersededAt: z.date().nullable().optional(),
  /**
   * The `limit-bytes-total` this voucher's router user should be carrying,
   * written here **before** the router is patched.
   *
   * That order is what makes a renewal idempotent. Computing "whatever the
   * router has now, plus this plan's allowance" at patch time is a
   * read-modify-write, and the retry path (/api/voucher/retry) or any
   * replay would top the customer up twice. Storing the absolute target
   * first means every subsequent attempt writes the same number.
   *
   * Null means no cap, which is not the same as zero - see
   * `renewalDataLimitBytes` in lib/voucher-renewal.ts.
   */
  dataLimitBytes: z.number().int().nonnegative().nullable().optional(),
  /**
   * What the renewal that created this voucher did to the credential it
   * took over, recorded at the moment it happened.
   *
   * The chain itself (`renewalOf`, `supersededBy`) says *that* a renewal
   * happened. This says what it cost, which stops being derivable the
   * moment a tenant turns the reset modes on: the discarded expiry is
   * overwritten on the router, and a data reset wipes the byte counters
   * that were the only record of what had been used. A customer asking
   * "where did my three days go" is answerable from here and nowhere else.
   *
   * The modes are stored rather than read back off the tenant, so flipping
   * a setting later does not rewrite what past renewals did. Absent on
   * every voucher that is not a renewal, and on renewals written before
   * this existed.
   */
  renewal: z
    .object({
      expiryMode: z.enum(["extend", "reset"]),
      dataMode: z.enum(["carry", "reset"]),
      /** Same value as `renewalOf`, kept here so the block stands alone. */
      previousVoucherId: z.string(),
      /** What the router said it was running to, before this renewal. */
      previousExpiresAt: z.date().nullable(),
      /** The cap that was on the router, null meaning uncapped. */
      previousLimitBytes: z.number().nonnegative().nullable(),
      /**
       * The router's lifetime counters at that moment, summed. Open
       * sessions are not in them (RouterOS does not fold a session in until
       * it ends), so this is a floor rather than an exact figure - enough to
       * answer what was spent, not an invoice.
       */
      previousBytesUsed: z.number().nonnegative().nullable(),
    })
    .nullable()
    .optional(),
  /**
   * When the `voucher-reap` cron deleted this voucher's user from the
   * router. Set only for vouchers that had already expired.
   *
   * Without it the reconciliation view in lib/hotspot-users.ts would report
   * every reaped voucher as "sold through the platform but missing on the
   * router" - true, and exactly the drift warning the reaper is meant to
   * stop producing. This is how a deliberate removal is told apart from one
   * nobody can account for.
   */
  routerUserReapedAt: z.date().nullable().optional(),
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
  reference: z.string().default(""), // Made optional with default
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
  reference: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  voucherId: z.string().optional(),
  /** The tenant's payee the sale was split to; null when it was not split. */
  payeeReference: z.string().nullable().optional(),
  // Nullable, not just optional: null means the split is not known (a sale from
  // before Knomad Pay with none reported), which must stay distinguishable from
  // a real zero.
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
  "acceptable-use",
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
  "developers",
  "email",
  "faq",
  "help",
  "legal",
  "login",
  "mail",
  "onboarding",
  "portal",
  "privacy",
  "register",
  "settings",
  "static",
  "status",
  "superadmin",
  "support",
  "terms",
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
  /**
   * Voucher codes the tenant may generate per billing cycle, before top-up
   * credits are drawn on. `null` is unlimited, like the others - but unlike
   * them the default is **0**, not null: a default of null would hand every
   * existing plan unlimited generation the moment the field shipped. Zero is
   * a real value here ("none included, credits only"), hence nonnegative.
   */
  maxGeneratedVouchers: z.number().int().nonnegative().nullable().default(0),
});

export const BillingPlanFeaturesSchema = z.object({
  /**
   * A logo and accent colour on the tenant's captive portal. Checked by
   * lib/portal-branding.ts: saving branding needs it, and the portal shows
   * saved branding only while the tenant's plan has it.
   */
  customBranding: z.boolean().default(false),
  // `apiAccess` used to sit here. API access is now the `api-access` addon,
  // bundled through `includedAddons` (lib/api-access.ts); a stored
  // `apiAccess` field on an old plan document is ignored.
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
   * Who the payment provider takes its fee from on this plan's voucher sales: the
   * platform (out of its share) or the tenant (out of theirs). Null means inherit
   * `PlatformConfig.feeBearer`, the default. See lib/processing-fees.ts.
   */
  feeBearer: z.enum(["platform", "tenant"]).nullable().default(null),
  /**
   * Marks a plan as one the company puts its own accounts on, rather than
   * anything a customer is sold.
   *
   * It changes no behaviour. It exists so that
   * `npm run check:internal-plan` can find these plans and assert they still
   * bundle every addon in the catalog - the one real weakness of comping
   * through a plan is adding an addon later and forgetting to include it
   * here, which takes the feature away from company accounts silently.
   *
   * A flag rather than matching on the plan's name, because a rename would
   * quietly stop the check finding anything, and a guard that has silently
   * stopped guarding is worse than no guard.
   */
  internal: z.boolean().default(false),
  limits: BillingPlanLimitsSchema.default({
    maxLocations: null,
    maxRouters: null,
    maxCustomers: null,
    maxGeneratedVouchers: 0,
  }),
  features: BillingPlanFeaturesSchema.default({
    customBranding: false,
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
/**
 * The tenant's logo and accent colour for their captive portal.
 *
 * On the tenant document rather than a document of its own, on purpose: the
 * portal already reads the tenant on every visit, and Firestore bills per
 * document, not per byte, so a separate branding document would be one more
 * read on the busiest page we serve. That only works because the logo is
 * tiny - lib/branding.ts caps it at a few kilobytes, which is also what lets
 * it travel to the router as text.
 *
 * Saved whatever the tenant's plan, shown only while their plan includes
 * `features.customBranding` (lib/portal-branding.ts), so a downgrade and an
 * upgrade hand the same branding back without the owner uploading it again.
 */
export const TenantBrandingSchema = z.object({
  /** A `data:image/(png|webp|jpeg);base64,...` URI, or null for none. */
  logo: z.string().nullable().default(null),
  /** `#rrggbb`, lower case, or null for the platform's own colour. */
  accentColor: z.string().nullable().default(null),
  /**
   * Bumped on every save. What router-health compares against each
   * location's `portalBrandSynced` to decide whether a router needs the
   * branding written again, so an unchanged brand costs no router writes.
   */
  version: z.number().int().nonnegative().default(0),
});
export type TenantBranding = z.infer<typeof TenantBrandingSchema>;

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
  /**
   * How far the plan is paid: the end of the last period paid for (lib/billing-charges.ts).
   * Nothing renews by itself; once this passes on a paid plan the fee is owed
   * (lib/billing-periods.ts). Null for a tenant who has never paid.
   */
  nextBillingDate: z.date().nullable().default(null),
  /**
   * When the owner was last told their unpaid plan fee had paused new sales.
   *
   * A send-once stamp, not a state: `PlanFeeState.locked` is derived from the
   * clock and is the only authority on whether anything is actually paused.
   * This exists so the daily cron does not send the same bad news every
   * morning.
   *
   * **Cleared by every path that can clear a lock**, so a tenant who pays,
   * trades for a year, lapses again and locks again is told again. A stamp
   * that was never cleared would mean the second lock is the silent one.
   */
  planFeeLockNotifiedAt: z.date().nullable().default(null),
  /**
   * The tenant's payee at Knomad Pay (a Monnify sub-account there), by our reference:
   * where their share of each voucher sale is split to. Null until it is made, and until
   * then their sales are refused (lib/knomad-pay-payees.ts).
   */
  knomadPayeeReference: z.string().nullable().default(null),
  bankName: z.string().nullable().default(null),
  /** The bank's code in Knomad Pay's (Monnify's) list, chosen at signup. Older tenants have
   * none and are matched by bank name (lib/knomad-pay-payees.ts). */
  bankCode: z.string().nullable().default(null),
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
  /**
   * Whether the captive portal shows the private/random MAC address notice.
   *
   * **On by default.** iOS and Android both ship private addressing turned
   * on, so the condition it warns about is the common case rather than the
   * exception, and a tenant who does not want it switches it off. One quiet
   * line under the Connect button is a cheap price for the device
   * recognition it protects.
   *
   * A default, not a backfill: `TenantSchema.parse` fills it in for every
   * tenant document that has no such field, which is all of them until an
   * owner saves this form. An owner who has explicitly switched it off has
   * `false` stored and stays off, which is the point of storing it.
   *
   * The copy is ours and fixed rather than a text field: it is a page we
   * generate, in our voice, and a wrong or alarming version of it produces
   * the support calls it exists to prevent.
   */
  portalMacNotice: z.boolean().default(true),
  /**
   * The venue's support line, published on the captive portal, stored E.164
   * (`+234...`) by lib/phone.ts. Null when the owner has not given one, in
   * which case nothing renders.
   */
  supportPhone: z.string().nullable().default(null),
  /**
   * Whether that same number is on WhatsApp. Meaningless on its own, so the
   * form disables it until a number is entered and the portal ignores it
   * when `supportPhone` is null.
   */
  supportPhoneIsWhatsapp: z.boolean().default(false),
  /**
   * What a renewal does to the customer's expiry date.
   *
   * `"extend"` is what shipped and stays the default: the new duration is
   * added to what they had left, so topping up two days into a seven-day
   * plan with two days still on it runs for nine. `"reset"` starts the plan
   * again from the moment it is paid for, which is simpler to explain at the
   * counter and is what several tenants expect, at the cost of discarding
   * whatever time was left.
   *
   * Tenant-wide rather than per plan on purpose: it is a house rule about
   * what renewing means, and a tenant whose Daily plan reset while their
   * Weekly accumulated would have to explain the difference to the same
   * customer.
   *
   * A default, not a backfill, exactly like `portalMacNotice` - every
   * existing tenant keeps today's behaviour until an owner changes it.
   */
  renewalExpiryMode: z.enum(["extend", "reset"]).default("extend"),
  /**
   * What a renewal does to the customer's data allowance.
   *
   * `"carry"` (the default, and what shipped) adds the plan's allowance to
   * the cap already on the router, which is what carries an unspent
   * remainder over. `"reset"` sets the cap to the plan's allowance **and
   * resets the router's byte counters**, because RouterOS measures lifetime
   * counters against that one number - setting the cap alone would leave a
   * customer who had used 4 of 5GB instantly exhausted on a plan they just
   * paid for.
   *
   * Independent of `renewalExpiryMode`: resetting the clock while carrying
   * data over is a perfectly ordinary house rule.
   */
  renewalDataMode: z.enum(["carry", "reset"]).default("carry"),
  /**
   * How this tenant's generated voucher codes look. The owner's to change,
   * from the Generate codes page; bounds are in lib/generated-codes.ts.
   * Only shapes codes generated after the change.
   */
  generatedCodeFormat: GeneratedCodeFormatSchema.default({
    length: 8,
    charset: "alnum",
    prefix: "",
    passwordMode: "same",
  }),
  /** A default, not a backfill: no branding until an owner saves some. */
  branding: TenantBrandingSchema.default({
    logo: null,
    accentColor: null,
    version: 0,
  }),
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
  // Null on a document that has not bought since this field was introduced.
  // What maxCustomers measures: see lib/active-customers.ts.
  lastPurchaseAt: z.date().nullable().default(null),
});

/**
 * A customer's chosen voucher credentials at one tenant, at
 * `tenants/{tenantId}/voucherCredentials/{uid}`.
 *
 * **Per tenant, not per account.** A tenant's owner can read their own
 * vouchers' passwords in the admin UI, which is right for a code on a
 * router they run and would not be right if it were the same password that
 * customer uses at every other tenant on the platform.
 *
 * **Its own subcollection, not a field on `TenantCustomer`.** That document
 * is created by a purchase, and having one is what exempts a buyer from
 * `BillingPlan.limits.maxCustomers`, so writing one here for somebody who has
 * only visited their profile page would let them past a full tenant without
 * ever having been a customer.
 *
 * Why the username is a handle plus a generated suffix rather than a name
 * the customer owns outright: lib/voucher-credentials.ts.
 */
export const VoucherCredentialSchema = z.object({
  uid: z.string(),
  handle: z.string(),
  /** Four characters, generated once and never rotated. */
  suffix: z.string(),
  password: z.string(),
  updatedAt: z.date(),
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
  // Required only when the first period has something to pay: the reference of the
  // payment started by /api/onboarding/payment (lib/billing-charges.ts).
  paymentReference: z.string().optional(),
  /**
   * An optional promo code. Whether it is real, still redeemable, and what
   * it grants is decided server-side at creation time; nothing the client
   * says about it is trusted or even read beyond the string itself.
   */
  couponCode: z.string().trim().max(32).optional(),
});

// Platform Configuration Schemas
export const PlatformConfigSchema = z.object({
  // Who the payment provider takes its fee from on a split voucher sale, unless the
  // tenant's plan says otherwise: the platform, out of its share, or the tenant, out of
  // theirs. See lib/processing-fees.ts.
  feeBearer: z.enum(["platform", "tenant"]).default("platform"),
  wireguard: z.object({
    serverPublicKey: z.string().default(""),
    serverEndpoint: z.string().default(""),
    tunnelSubnet: z.string().default("10.10.0.0/16"),
  }),
  // Makes the PAYER (the customer buying a voucher, or the tenant paying the
  // platform) cover an estimate of the payment provider's fee on top of the
  // listed price, instead of it coming out of a share - see lib/processing-fees.ts
  // and docs/billing-and-payments.md. Off by default.
  processingFeePassthrough: z
    .object({
      enabled: z.boolean().default(false),
      // A formula, not a lookup: the provider's real fee is only known after the
      // charge. Any gap between this estimate and the real fee falls on whoever
      // bears the fee (`feeBearer`), never on the other side's share.
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
  /**
   * How many days a tenant keeps selling after their plan fee falls due,
   * before new sales and owner changes are paused (lib/billing-lock.ts).
   *
   * Platform policy rather than a plan feature, which is why it sits here
   * and not on BillingPlan: it is the same promise to every tenant, and a
   * grace window that varied by tier is the kind of difference nobody can
   * explain on a support call.
   *
   * Zero is a legitimate value and means the lock lands the moment the fee
   * is owed. There is no "off" - set it high if that is what you want, so
   * the number on the page is always the real answer.
   */
  planFeeGraceDays: z.number().int().min(0).max(365).default(3),
  /**
   * When voucher charges started having to come from /api/purchase/initiate.
   * Null until a superadmin switches it on, and while null every charge is
   * fulfilled the way it always was. Once set, a successful charge with no
   * pending record that the gateway says was paid after this moment goes to
   * payment review instead of becoming a voucher (lib/charge-authority.ts).
   *
   * A timestamp rather than a boolean so a checkout opened just before the
   * switch, in a tab that has not reloaded, is still honoured.
   */
  serverCheckoutRequiredSince: z.date().nullable().default(null),
  /**
   * Platform-wide bounds on tenant voucher generation (docs/voucher-generation.md).
   * How many a tenant may generate is their plan's allowance plus credits;
   * these are the guard rails around any one request and any one router,
   * whatever the quota says.
   *
   * `maxBatchSize` is capped at 500 because a batch keeps every code inside
   * one document, and 500 leaves the document far below Firestore's 1 MiB.
   * `maxUnusedPerRouter` bounds the per-router index the router-health cron
   * reads on every tick to spot first use, which is also one document: at
   * 10,000 entries of about 40 bytes it stays under half of the 1 MiB limit.
   */
  voucherGeneration: z
    .object({
      maxBatchSize: z.number().int().min(1).max(500).default(200),
      maxUnusedPerRouter: z.number().int().min(1).max(10000).default(5000),
    })
    .default({ maxBatchSize: 200, maxUnusedPerRouter: 5000 }),
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
export type VoucherCredential = z.infer<typeof VoucherCredentialSchema>;
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
 * `prioritySupport` flag is still in on this platform (and `apiAccess` was,
 * until it became the `api-access` addon; `customBranding` was, until
 * lib/portal-branding.ts started checking it). lib/addon-catalog.ts is the list; this is its pricing.
 */
export const UpdateAddonInputSchema = AddonSchema.omit({
  key: true,
  createdAt: true,
  updatedAt: true,
});
export type UpdateAddonInput = z.infer<typeof UpdateAddonInputSchema>;

/**
 * Where an entitlement stands.
 *
 * Payments write only `active`, with a period end; the clock decides the rest
 * (lib/entitlements.ts). `past_due` and `cancelled` come only from records of
 * the Paystack subscription days, and are still read as they were.
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
  /**
   * "plan" grants are implicit and never stored. "purchase" is a tenant who
   * paid; "grant" is a superadmin handing it over, which is what
   * grandfathering and comped accounts write. Nothing in
   * `evaluateEntitlement` reads this - it exists so revenue reporting and
   * anyone asking "why does this tenant have this" can tell the two apart.
   */
  source: z.enum(["purchase", "grant"]).default("purchase"),
  status: EntitlementStatusSchema,
  pricingModel: AddonPricingModelSchema,
  /** The addon's own subscription, never the tenant's platform one. */
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
 * How a discount is expressed. `percent` is 1-100 where 100 is a full
 * waiver; `amount` is a flat sum in kobo, floored at the fee so it can never
 * produce a negative charge.
 */
export const DiscountTypeSchema = z.enum(["percent", "amount"]);
export type DiscountType = z.infer<typeof DiscountTypeSchema>;

/**
 * A waiver of a tenant's **plan fee** for a window of time.
 *
 * Deliberately narrow. It waives the monthly fee a tenant pays the platform
 * and nothing else: the platform's commission on voucher sales is never
 * waived here: it is the plan's `platformFeePercent`. An account that should
 * also keep 100% of its sales belongs on a plan whose `platformFeePercent`
 * is 0.
 *
 * The tenant's `planId` never changes while one of these is live. That is
 * the whole point: the plan stays the record of what they chose and agreed
 * to pay, so when the window closes they are back on it with nothing to
 * migrate and nothing to remember.
 */
export const FeeWaiverSchema = z.object({
  id: z.string(),
  /**
   * What was taken off the plan fee, recorded as given rather than
   * recomputed later: the plan's price can change afterwards, and this has
   * to keep answering what this tenant was actually charged.
   *
   * A full waiver is `percent` / 100, which is the overwhelming common case
   * and why the collection is still called `feeWaivers`.
   */
  discountType: DiscountTypeSchema.default("percent"),
  discountValue: z.number().int().positive().default(100),
  /** The resolved sum in kobo, against the fee at the time it was applied. */
  discountKobo: z.number().int().nonnegative().default(0),
  /**
   * When the waiver stops applying. Every waiver carries one: an open-ended
   * comp belongs on a plan, not here.
   *
   * Still nullable, and `isWaiverActive` still reads null as "no end", so a
   * document written before that was settled keeps working rather than
   * silently switching off. Tolerant on read, strict on write - nothing
   * creates one of these any more.
   */
  endsAt: z.date().nullable().default(null),
  startsAt: z.date(),
  source: z.enum(["coupon", "trial", "manual"]),
  /** Set only when `source` is "coupon". */
  couponCode: z.string().nullable().default(null),
  /** Free text for the audit trail - why this tenant, decided by whom. */
  reason: z.string().default(""),
  /** The uid of the superadmin who created it, or null for an automatic one. */
  grantedBy: z.string().nullable().default(null),
  /**
   * Set when someone ends a waiver early. Kept rather than deleted so the
   * history still answers "was this tenant comped last March".
   */
  revokedAt: z.date().nullable().default(null),
  createdAt: z.date(),
});
export type FeeWaiver = z.infer<typeof FeeWaiverSchema>;

/**
 * A promo code that waives a new tenant's plan fee for a fixed number of
 * days from signup.
 *
 * Stored at `coupons/{CODE}` with the normalised code as the document id,
 * the same trick `subscriptionIndex` uses: redemption is a get-by-id rather
 * than a query, so it needs no composite index, cannot return two documents,
 * and uniqueness is free.
 *
 * Deliberately cannot grant a permanent waiver. A comp that never ends is a
 * commercial decision about one account, which belongs on a plan a
 * superadmin assigns by hand - not on a string someone can paste into a
 * signup form. `durationDays` is required and bounded for the same reason.
 */
export const CouponSchema = z.object({
  /** Normalised to upper case. Also the document id. */
  code: z.string().min(3).max(32),
  description: z.string().default(""),
  discountType: DiscountTypeSchema.default("percent"),
  /** Percent (1-100) or kobo, depending on `discountType`. */
  discountValue: z.number().int().positive().default(100),
  /**
   * How long the discounted rate lasts, counted from redemption.
   *
   * At 100% this is straightforwardly "N days free". Below that, every monthly
   * payment that starts inside the window is at the reduced price, the first
   * at signup (lib/billing-periods.ts). See docs/billing-and-payments.md.
   */
  durationDays: z.number().int().min(1).max(730),
  /** Null means unlimited redemptions. */
  maxRedemptions: z.number().int().positive().nullable().default(null),
  timesRedeemed: z.number().int().nonnegative().default(0),
  /** When the code stops being redeemable. Null means it never does. */
  expiresAt: z.date().nullable().default(null),
  active: z.boolean().default(true),
  createdBy: z.string().nullable().default(null),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Coupon = z.infer<typeof CouponSchema>;

