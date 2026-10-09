/**
 * Every email this platform can send, declared once, in code.
 *
 * The catalog is deliberately NOT stored in Firestore. Which emails exist is
 * a property of the code that calls `sendEmail()` - if an entry could be
 * deleted from a database, a live call site would start referring to a key
 * that no longer exists. Firestore only ever holds the *mutable* part: the
 * Mailtrap template each key maps onto, and whether it is switched on
 * (see `lib/email-templates.ts`).
 *
 * Adding a new email is therefore two steps and no migration: add an entry
 * here, then call `sendEmail()` with its key. It shows up on the superadmin
 * Emails page automatically, waiting for a template ID.
 */

export const EMAIL_AUDIENCES = ["customer", "owner", "platform"] as const;
export type EmailAudience = (typeof EMAIL_AUDIENCES)[number];

/**
 * `wired` - a call site exists and this fires today.
 * `planned` - listed so it can be configured ahead of time, but nothing
 *   calls it yet. Every current `planned` entry is waiting on a scheduler;
 *   this app has no cron of any kind (see docs/emails.md).
 */
export type EmailWiringStatus = "wired" | "planned";

export interface EmailDefinition {
  key: string;
  name: string;
  audience: EmailAudience;
  /** What makes this send, in the user's terms - shown on the admin page. */
  description: string;
  /** Where in the code it fires from - shown to whoever has to debug it. */
  trigger: string;
  status: EmailWiringStatus;
  /**
   * The variable names handed to Mailtrap as `template_variables`. The
   * Mailtrap template is written against exactly these names; the admin
   * page lists them so whoever builds the template knows what it gets.
   */
  variables: readonly string[];
}

export const EMAIL_CATALOG = [
  // ---------------------------------------------------------------- customer
  {
    key: "customer.welcome",
    name: "Welcome / account created",
    audience: "customer",
    description:
      "Sent once, the first time an account is created. Only fires on genuine first registration - /api/auth/register is also called on every subsequent sign-in to re-sync claims, and that path must never re-send it.",
    trigger: "POST /api/auth/register, only when the user document is created",
    status: "wired",
    variables: ["customer_email", "app_url"],
  },
  {
    key: "customer.voucher_ready",
    name: "Voucher ready",
    audience: "customer",
    description:
      "Delivers the voucher username and password straight after a successful purchase. The only lasting copy a guest buyer ever gets - the portal shows the credentials once and a guest has no account to look them up under later.",
    trigger: "POST /api/payment/verify, after the voucher is created active",
    status: "wired",
    variables: [
      "customer_email",
      "business_name",
      "plan_name",
      "location_name",
      "voucher_username",
      "voucher_password",
      "duration",
      "data_limit",
      "amount",
      "reference",
      "portal_url",
    ],
  },
  {
    key: "customer.voucher_pending",
    name: "Voucher pending (activation failed)",
    audience: "customer",
    description:
      "Payment went through but creating the login on the router did not. Tells the customer their access is being set up rather than leaving them staring at a portal that will not let them in.",
    trigger: "POST /api/payment/verify, the MikroTik-failure branch",
    status: "wired",
    variables: [
      "customer_email",
      "business_name",
      "plan_name",
      "location_name",
      "amount",
      "reference",
      "support_email",
    ],
  },
  {
    key: "customer.voucher_activated",
    name: "Voucher now active",
    audience: "customer",
    description:
      "Closes the loop after an owner retries a failed voucher from the Failed Queue - carries the credentials that could not be delivered the first time.",
    trigger: "POST /api/voucher/retry, on success",
    status: "wired",
    variables: [
      "customer_email",
      "business_name",
      "plan_name",
      "location_name",
      "voucher_username",
      "voucher_password",
      "duration",
      "data_limit",
      "portal_url",
    ],
  },
  {
    key: "customer.voucher_expiring",
    name: "Voucher expiring soon",
    audience: "customer",
    description:
      "A nudge shortly before access runs out, with a link back to buy again.",
    trigger: "Cron job voucher-expiry, within an hour of expiry",
    status: "wired",
    variables: [
      "customer_email",
      "business_name",
      "plan_name",
      "expires_at",
      "portal_url",
    ],
  },

  // ------------------------------------------------------------------- owner
  {
    key: "owner.welcome",
    name: "Welcome / account ready",
    audience: "owner",
    description:
      "Sent once the tenant document is written at the end of onboarding. Carries the portal URL and admin URL - today a new owner finishes paying and is told nothing.",
    trigger: "POST /api/onboarding/create-tenant, after the tenant is written",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "slug",
      "plan_name",
      "monthly_fee",
      "portal_url",
      "admin_url",
    ],
  },
  {
    key: "owner.voucher_failed",
    name: "A paid voucher needs attention",
    audience: "owner",
    description:
      "A customer paid but the router login could not be created. Without this the owner only finds out by happening to open the Failed Queue, while a paying customer waits.",
    trigger: "POST /api/payment/verify, the MikroTik-failure branch",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "customer_email",
      "plan_name",
      "location_name",
      "failure_reason",
      "amount",
      "failed_queue_url",
    ],
  },
  {
    key: "owner.limit_approaching",
    name: "Approaching a plan limit",
    audience: "owner",
    description:
      "Fires at 80% of a billing-plan limit. Hitting the customer cap silently blocks every brand-new buyer, so the warning matters more than the notice that it has already happened.",
    trigger: "POST /api/payment/verify, after the customer roster is updated",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "limit_type",
      "current_count",
      "limit_value",
      "plan_name",
      "billing_url",
    ],
  },
  {
    key: "owner.limit_reached",
    name: "Plan limit reached",
    audience: "owner",
    description:
      "The tenant is at a limit on their billing plan. New customers are now being turned away at the portal before payment.",
    trigger: "POST /api/payment/verify, after the customer roster is updated",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "limit_type",
      "limit_value",
      "plan_name",
      "billing_url",
    ],
  },
  {
    key: "owner.subscription_payment_failed",
    name: "Subscription payment failed",
    audience: "owner",
    description:
      "Paystack could not charge the tenant's subscription. The account is now past due and heading for suspension - today this is recorded in Firestore and told to nobody.",
    trigger: "Paystack webhook, invoice.payment_failed",
    status: "wired",
    variables: ["owner_email", "business_name", "plan_name", "amount", "billing_url"],
  },
  {
    key: "owner.subscription_renewed",
    name: "Subscription renewed",
    audience: "owner",
    description:
      "Confirms a successful recurring charge and the next billing date.",
    trigger: "Paystack webhook, invoice.payment_succeeded / charge.success",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "plan_name",
      "amount",
      "next_billing_date",
      "billing_url",
    ],
  },
  {
    key: "owner.subscription_cancelled",
    name: "Subscription cancelled",
    audience: "owner",
    description:
      "The recurring subscription will not renew. Says what happens to the account when the current period ends.",
    trigger: "Paystack webhook, subscription.not_renew",
    status: "wired",
    variables: ["owner_email", "business_name", "plan_name", "billing_url"],
  },
  {
    key: "owner.account_suspended",
    name: "Account suspended",
    audience: "owner",
    description:
      "A suspended tenant's portal goes dead platform-wide. The owner currently gets no warning and no explanation.",
    trigger: "PATCH /api/superadmin/tenants/[id], status set to suspended",
    status: "wired",
    variables: ["owner_email", "business_name", "support_email"],
  },
  {
    key: "owner.account_reactivated",
    name: "Account reactivated",
    audience: "owner",
    description: "The portal is live again after a suspension.",
    trigger: "PATCH /api/superadmin/tenants/[id], status set back to active",
    status: "wired",
    variables: ["owner_email", "business_name", "portal_url"],
  },
  {
    key: "owner.router_offline",
    name: "Router offline",
    audience: "owner",
    description:
      "An offline router means every sale at that location fails. Sent on the transition into offline, never on the state, so a router down overnight does not mail the owner every tick.",
    trigger: "Cron job router-health, on an online to offline transition",
    status: "wired",
    variables: ["owner_email", "business_name", "router_name", "location_name", "last_seen"],
  },

  // ---------------------------------------------------------------- platform
  {
    key: "platform.new_tenant",
    name: "New tenant signed up",
    audience: "platform",
    description:
      "Tells the platform operator a tenant completed onboarding, with the plan they chose.",
    trigger: "POST /api/onboarding/create-tenant, after the tenant is written",
    status: "wired",
    variables: [
      "business_name",
      "slug",
      "owner_email",
      "plan_name",
      "monthly_fee",
      "tenant_admin_url",
    ],
  },
  {
    key: "platform.split_mismatch",
    name: "Payment split mismatch",
    audience: "platform",
    description:
      "Paystack applied a different revenue split than this app expected. Deliberately never blocks the payment, so without an alert it is only ever a line in a production log.",
    trigger: "POST /api/payment/verify, when the recorded split does not match",
    status: "wired",
    variables: [
      "business_name",
      "reference",
      "expected_share",
      "received_share",
      "amount",
    ],
  },
] as const satisfies readonly EmailDefinition[];

export type EmailKey = (typeof EMAIL_CATALOG)[number]["key"];

export const EMAIL_KEYS = EMAIL_CATALOG.map((e) => e.key) as EmailKey[];

export function getEmailDefinition(key: EmailKey): EmailDefinition | undefined {
  return EMAIL_CATALOG.find((e) => e.key === key);
}

export function isEmailKey(value: string): value is EmailKey {
  return EMAIL_CATALOG.some((e) => e.key === value);
}

export const EMAIL_AUDIENCE_LABELS: Record<EmailAudience, string> = {
  customer: "Customer",
  owner: "Tenant owner",
  platform: "Platform",
};
