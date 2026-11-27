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
  /**
   * Present when a tenant owner may switch this off for themselves, carrying
   * the copy their settings page shows for the switch.
   *
   * `description` above is written for whoever has to debug or configure the
   * email and says things like "until this existed the owner only ever heard
   * from us when something went wrong" - true, and not what an owner wants to
   * read next to a toggle. Hence a second, owner-facing wording rather than
   * reusing that one.
   *
   * Absent means mandatory, and that is the deliberate default: an owner who
   * muted "your payment failed" or "your router is offline" would be opting
   * out of finding out their business had stopped working. Only emails whose
   * worst case is a quieter inbox carry this - everything operational,
   * financial or account-related stays unconditional.
   *
   * This is also not the superadmin switch at /superadmin/emails: that one is
   * platform-wide and stops the email for everybody.
   */
  optional?: {
    /** The switch's label, in the owner's terms. */
    label: string;
    /** One line under it: what arrives, and how often. */
    help: string;
  };
}

export const EMAIL_CATALOG = [
  // ---------------------------------------------------------------- customer
  {
    key: "customer.welcome",
    name: "Welcome / account created",
    audience: "customer",
    description:
      "Sent once, the first time an account is created. Only fires on genuine first registration - /api/auth/register is also called on every subsequent sign-in to re-sync claims and reconcile a changed email, and that path must never re-send it.",
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
      "devices",
      "amount",
      "reference",
      "portal_url",
    ],
  },
  {
    key: "customer.voucher_renewed",
    name: "Voucher renewed (topped up)",
    audience: "customer",
    description:
      "Sent instead of 'Voucher ready' when a repeat purchase renewed the code the customer already has rather than issuing a new one. Carries the same username and password plus the new end date, because the thing they most need to know is that nothing changed except how long it lasts. `renewal_note` is one sentence saying whether their leftover time and data carried over or started again, which is the tenant's own setting and not something this template can state on its own. Falls back to customer.voucher_ready when this template is not configured - a renewal arriving with no email at all would read to the customer as money taken for nothing.",
    trigger: "Voucher fulfilment, the renewal branch in lib/voucher-fulfilment.ts",
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
      "devices",
      "expires_at",
      "renewal_note",
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
      "devices",
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

  {
    key: "customer.verify_email",
    name: "Confirm your email address",
    audience: "customer",
    description:
      "Carries a link that proves the address works. Never blocks anything: a customer buys, connects and gets their voucher whether or not they have confirmed. It exists because the voucher email is the only lasting copy of their credentials, so a typo costs them the thing they paid for.",
    trigger:
      "POST /api/auth/send-verification, from the banner or straight after registration",
    status: "wired",
    variables: ["customer_email", "verify_url"],
  },
  {
    key: "customer.verify_new_email",
    name: "Confirm your new email address",
    audience: "customer",
    description:
      "Sent to the NEW address when a customer changes their email, and the change only commits once it is clicked. Deliberately never sent to the old address - not controlling the old mailbox is the commonest reason to change it.",
    trigger: "POST /api/auth/change-email",
    status: "wired",
    variables: ["customer_email", "previous_email", "verify_url"],
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
      "billing_note",
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
    key: "owner.voucher_sold",
    name: "You made a sale",
    audience: "owner",
    description:
      "A voucher was paid for and issued. Until this existed the owner only ever heard from us when something went wrong - a failed voucher, a limit, an offline router - and never when the business worked.",
    trigger:
      "lib/voucher-fulfilment.ts, after the voucher is issued and the router user created",
    status: "wired",
    optional: {
      label: "Every sale",
      help: "An email each time a customer buys a voucher, with the plan, the location and your share. Best for a quiet location - a busy one can send a lot of these in a day.",
    },
    variables: [
      "owner_email",
      "business_name",
      "customer_email",
      "plan_name",
      "location_name",
      "amount",
      "tenant_share",
      "vouchers_url",
    ],
  },
  {
    key: "owner.sales_digest",
    name: "Yesterday's sales",
    audience: "owner",
    description:
      "One summary a day instead of one email a sale. The alternative to owner.voucher_sold for a busy location, where thirty emails a day gets the sender muted and takes the failure alerts down with it. Sent only on days that had at least one sale.",
    trigger: "The sales-digest cron job, daily (lib/cron-jobs.ts)",
    status: "wired",
    optional: {
      label: "Daily sales summary",
      help: "One email each morning covering the previous day's sales. Nothing is sent on a day with no sales.",
    },
    variables: [
      "owner_email",
      "business_name",
      "period",
      "voucher_count",
      "gross_amount",
      "tenant_share",
      "location_breakdown",
      "vouchers_url",
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
      "The tenant is at a limit on their billing plan, which for customers means people who bought in the last 30 days. Brand-new customers are now turned away before payment; anyone who has bought before can still buy.",
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
    key: "owner.plan_fee_ending",
    name: "Plan fee due soon",
    audience: "owner",
    description:
      "A warning a few days before the plan fee is next owed: a free period (trial or promo) closing, or the month they paid for running out. Nothing renews by itself, so without this the fee would fall due in silence. Names the grace window, and that paying now loses none of the time they still have.",
    trigger: "Cron job plan-fee-due, within the warning window before a waiver or a paid month ends",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "plan_name",
      "monthly_fee",
      "ends_at",
      "grace_days",
      "settings_url",
    ],
  },

  {
    key: "owner.plan_fee_due",
    name: "Plan fee now due",
    audience: "owner",
    description:
      "A free period has closed, or a paid month has run out, and the plan fee is owed. Carries the link to pay. A grace window starts here (PlatformConfig.planFeeGraceDays), and when it runs out new voucher sales stop - so this is the owner's warning before trading is interrupted, not just a reminder.",
    trigger: "Cron job plan-fee-due, once a waiver or a paid month has ended",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "plan_name",
      "monthly_fee",
      "locks_at",
      "settings_url",
    ],
  },

  {
    key: "owner.plan_fee_locked",
    name: "New sales paused",
    audience: "owner",
    description:
      "The grace window after an unpaid plan fee has run out and new voucher sales have stopped. The last of three, and the only one that reports something that has already happened rather than something coming - so it is the one that must never be the first an owner hears of this. Sent once per lapse: the stamp is cleared when they pay, so a later lapse notifies again.",
    trigger: "Cron job plan-fee-due, once PlanFeeState.locked is true",
    status: "wired",
    variables: [
      "owner_email",
      "business_name",
      "plan_name",
      "monthly_fee",
      "locked_since",
      "settings_url",
    ],
  },

  {
    // The key is from when this was a Paystack subscription's renewal, kept so the
    // Mailtrap template already configured for it carries on.
    key: "owner.subscription_renewed",
    name: "Plan payment received",
    audience: "owner",
    description:
      "A receipt for a plan period the owner has just paid, with the date it is paid until. Nothing renews by itself, so it also says when the next payment is due.",
    trigger: "A plan payment applied (lib/billing-charges.ts), from the dashboard, Knomad Pay's event or the reconcile cron",
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
    key: "owner.purchase_received",
    name: "Purchase received",
    audience: "owner",
    description:
      "A receipt for something the owner bought besides their plan: an addon, or voucher generation credits. Says what it was, what was paid, and what they have now.",
    trigger: "An addon or credits payment applied (lib/billing-charges.ts), from the dashboard, Knomad Pay's event or the reconcile cron",
    status: "wired",
    variables: ["owner_email", "business_name", "item", "amount", "detail", "action_url"],
  },
  {
    key: "owner.payout_account_changed",
    name: "Payout account changed",
    audience: "owner",
    description:
      "The bank account the tenant's share of each sale is paid into was changed. Sent every time, to the owner, because a payout account changed without them knowing is how their money would be taken. Says what to do if it was not them.",
    trigger: "PUT /api/admin/payout-account (lib/payout-account.ts)",
    status: "wired",
    variables: ["owner_email", "business_name", "bank_name", "account_last4", "settings_url"],
  },
  {
    key: "owner.addon_renewal_due",
    name: "Addon running out",
    audience: "owner",
    description:
      "A few days before a paid month (or year) of an addon runs out. Nothing renews by itself, so this is how an owner hears the addon is about to stop, with the link to pay for the next period.",
    trigger: "Cron job plan-fee-due, within the warning window before an addon's paid period ends",
    status: "wired",
    variables: ["owner_email", "business_name", "addon_name", "amount", "ends_at", "addons_url"],
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

  {
    key: "owner.hook_failing",
    name: "Decision hook is failing",
    audience: "owner",
    description:
      "The tenant's pre-purchase hook failed ten times in a row and we stopped calling it. For a hook set to block, this is the email that says sales have stopped. Sent once per trip, never per failure.",
    trigger: "Decision hook circuit breaker opening (lib/decision-hooks.ts)",
    status: "wired",
    variables: ["owner_email", "business_name", "hook_name", "effect", "last_error", "hooks_url"],
  },
  {
    key: "owner.hook_recovered",
    name: "Decision hook is working again",
    audience: "owner",
    description:
      "The hook that was failing answered a probe correctly, so we are calling it again. Sent only if the failing email went out first.",
    trigger: "Decision hook circuit breaker closing (lib/decision-hooks.ts)",
    status: "wired",
    variables: ["owner_email", "business_name", "hook_name", "hooks_url"],
  },

  {
    key: "owner.webhook_disabled",
    name: "Webhook endpoint switched off",
    audience: "owner",
    description:
      "A webhook endpoint accepted nothing for three days, so it was switched off. Sent once, on the transition. Events stop; the data is still in the API.",
    trigger: "Webhook delivery, when an endpoint's failing clock passes three days (lib/webhooks.ts)",
    status: "wired",
    variables: ["owner_email", "business_name", "endpoint_url", "webhooks_url"],
  },

  {
    key: "owner.verify_email",
    name: "Confirm your email address",
    audience: "owner",
    description:
      "Same link as the customer version, different stakes. This address receives sales digests, failed-voucher alerts and router-offline warnings, so an unconfirmed one means the alerts that matter most may be going nowhere. Blocks nothing: onboarding completes and the portal runs regardless.",
    trigger:
      "POST /api/auth/send-verification, from the banner on the admin pages",
    status: "wired",
    variables: ["owner_email", "business_name", "verify_url"],
  },
  {
    key: "owner.verify_new_email",
    name: "Confirm your new email address",
    audience: "owner",
    description:
      "Sent to the NEW address when an owner changes the email on their account. The change commits only when the link is clicked, and the old address is never asked to confirm anything.",
    trigger: "POST /api/auth/change-email",
    status: "wired",
    variables: ["owner_email", "business_name", "previous_email", "verify_url"],
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
    key: "platform.daily_digest",
    name: "Platform daily digest",
    audience: "platform",
    description:
      "Yesterday across every tenant: what the platform earned, and more importantly what needs attention. The exceptions half exists because an unfulfilled payment went unnoticed for a day once, with the customer's own Paystack receipt as the only evidence a sale had happened.",
    trigger: "The sales-digest cron job, daily (lib/cron-jobs.ts)",
    status: "wired",
    variables: [
      "period",
      "voucher_count",
      "gross_amount",
      "platform_revenue",
      "tenant_count",
      "tenant_breakdown",
      "attention",
      "superadmin_url",
    ],
  },
  {
    key: "platform.split_mismatch",
    name: "Payment split mismatch",
    audience: "platform",
    description:
      "Knomad Pay reported a different revenue split than this app worked out for the sale. Deliberately never blocks the payment, so without an alert it is only ever a line in a production log.",
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
  {
    key: "platform.payment_review",
    name: "Paid charge needs review",
    audience: "platform",
    description:
      "A customer's charge cleared but no voucher could be issued automatically (plan switched off mid-checkout, amount or currency mismatch, router gone). The customer was told support is on it; this email is what makes that true.",
    trigger: "Voucher fulfilment, the first time a reference is recorded in paymentReviews",
    status: "wired",
    variables: [
      "business_name",
      "reference",
      "reason",
      "detail",
      "amount",
      "customer_email",
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

/**
 * The emails a tenant owner can switch off for themselves, in the order the
 * settings page should list them.
 *
 * Derived from the catalog rather than written out again, so flagging one
 * more `optional` is the only edit needed to offer it - and so this list can
 * never drift into naming a key that no longer exists.
 */
export const OPTIONAL_OWNER_EMAILS: readonly EmailDefinition[] = (
  EMAIL_CATALOG as readonly EmailDefinition[]
).filter((e) => e.audience === "owner" && e.optional);

export function isOptionalEmail(key: string): boolean {
  return OPTIONAL_OWNER_EMAILS.some((e) => e.key === key);
}
