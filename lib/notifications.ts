/**
 * Domain-level email notifications.
 *
 * One function per thing that happens, each assembling the variables its
 * Mailtrap template is written against (the variable list is declared
 * alongside the email in `lib/email-catalog.ts`). Call sites stay one line
 * and never have to know a template ID, a recipient rule, or a formatting
 * convention.
 *
 * Every function here returns rather than throws - see `lib/email.ts` for
 * why that matters at the call sites, which are all downstream of money
 * having already moved.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import {
  absoluteUrl,
  platformRecipients,
  sendEmail,
  type EmailSendOutcome,
} from "@/lib/email";
import { tenantUrl } from "@/lib/tenant-url";
import {
  DEFAULT_RENEWAL_MODES,
  type RenewalModes,
} from "@/lib/voucher-renewal";
import { getPlatformConfig } from "@/lib/platform-config";
import {
  DISPLAY_TIME_ZONE,
  formatDeviceCount,
  formatNaira,
} from "@/lib/utils";
import { missingLoginList } from "@/lib/missing-logins";

/**
 * A date as an email should say it: long month, Lagos time.
 *
 * The same four lines were inline at six call sites, and the one that
 * mattered most - a deadline a tenant is held to - must not be the seventh
 * copy that quietly forgets `timeZone` and reports the VPS's UTC day. The
 * server runs UTC and the business runs WAT, so an unqualified date is a day
 * early for anything after 23:00.
 */
function emailDay(date: Date): string {
  return date.toLocaleDateString("en-NG", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The grace window as a phrase, because "1 days" is the kind of thing that
 * ships and then turns up in a screenshot.
 *
 * Zero is a legitimate setting and has no plural form that reads sensibly,
 * so it gets its own wording rather than "0 days".
 */
function describeGraceDays(days: number): string {
  if (days <= 0) return "no grace period";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export type PlanLimitType = "maxCustomers" | "maxLocations" | "maxRouters";

const LIMIT_LABELS: Record<PlanLimitType, string> = {
  maxCustomers: "active customers",
  maxLocations: "locations",
  maxRouters: "routers",
};

interface TenantSummary {
  id: string;
  slug: string;
  businessName: string;
  ownerEmail: string | null;
  planName: string;
  monthlyFee: number;
  portalUrl: string;
  adminUrl: string;
}

/**
 * Most call sites hold a tenantId and nothing else. Returns null rather than throwing
 * so a missing tenant degrades to "no email" instead of a 500.
 */
async function loadTenant(tenantId: string): Promise<TenantSummary | null> {
  try {
    const doc = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .doc(tenantId)
      .get();
    if (!doc.exists) return null;

    const data = doc.data()!;
    const slug = String(data.slug ?? "");

    return {
      id: tenantId,
      slug,
      businessName: String(data.businessName ?? "your business"),
      ownerEmail: data.ownerEmail ? String(data.ownerEmail) : null,
      planName: String(data.planName ?? ""),
      monthlyFee: Number(data.monthlyFee ?? 0),
      portalUrl: absoluteUrl(tenantUrl(slug)),
      adminUrl: absoluteUrl(tenantUrl(slug, "/admin")),
    };
  } catch (error) {
    console.error(`[notifications] failed to load tenant ${tenantId}:`, error);
    return null;
  }
}

// ------------------------------------------------------------------ customer

export async function notifyCustomerWelcome(email: string): Promise<void> {
  await sendEmail("customer.welcome", {
    to: email,
    variables: { customer_email: email },
  });
}

/**
 * Both halves of email verification, for both audiences.
 *
 * One function rather than four call sites, because the only thing that
 * actually differs is which catalog key and which variable names the template
 * is written against - and getting that pairing wrong sends an owner a
 * customer-shaped email with a blank business name.
 *
 * The link itself is minted by the Admin SDK (generateEmailVerificationLink /
 * generateVerifyAndChangeEmailLink) and only delivered here, so Firebase keeps
 * ownership of the token and we keep ownership of what it looks like. See
 * docs/auth-and-security.md.
 *
 * Returns the send outcome rather than void, unlike everything else in this
 * file. A change-email flow that silently skipped - which is what an
 * unconfigured template does - would leave someone staring at "check your
 * inbox" forever, so the caller has to be able to tell them otherwise.
 */
export async function notifyVerifyEmail(params: {
  email: string;
  verifyUrl: string;
  /** Present for an owner, absent for a customer. Decides which email sends. */
  tenantId?: string | null;
  /** Set when this confirms a *new* address rather than the current one. */
  previousEmail?: string | null;
}): Promise<EmailSendOutcome> {
  const isChange = Boolean(params.previousEmail);
  const tenant = params.tenantId ? await loadTenant(params.tenantId) : null;

  if (tenant) {
    return sendEmail(isChange ? "owner.verify_new_email" : "owner.verify_email", {
      to: params.email,
      // Deliberately no tenantId: verification is not an optional email and
      // must not be mutable by the owner's notification preferences. Passing
      // it would be harmless today, since only `optional` keys can be muted,
      // but the omission says why.
      variables: {
        owner_email: params.email,
        business_name: tenant.businessName,
        ...(isChange ? { previous_email: params.previousEmail ?? "" } : {}),
        verify_url: params.verifyUrl,
      },
    });
  }

  return sendEmail(
    isChange ? "customer.verify_new_email" : "customer.verify_email",
    {
      to: params.email,
      variables: {
        customer_email: params.email,
        ...(isChange ? { previous_email: params.previousEmail ?? "" } : {}),
        verify_url: params.verifyUrl,
      },
    }
  );
}

export async function notifyVoucherReady(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  username: string;
  password: string;
  duration: string;
  dataLimit?: string | null;
  sharedUsers?: string | null;
  amountKobo: number;
  reference: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  await sendEmail("customer.voucher_ready", {
    to: params.customerEmail,
    variables: {
      customer_email: params.customerEmail,
      business_name: tenant?.businessName ?? "",
      plan_name: params.planName,
      location_name: params.locationName,
      voucher_username: params.username,
      voucher_password: params.password,
      duration: params.duration,
      data_limit: params.dataLimit || "Unlimited",
      // The row always renders, so this says so plainly rather than going
      // blank: a plan saved before the value was captured has no number to
      // show, and inventing one on a receipt is worse than admitting it.
      devices: formatDeviceCount(params.sharedUsers) ?? "Not specified",
      amount: formatNaira(params.amountKobo),
      reference: params.reference,
      portal_url: tenant?.portalUrl ?? "",
    },
  });
}

/**
 * The renewal counterpart of `notifyVoucherReady`.
 *
 * A top-up needs a different message from a first purchase: the credentials
 * have not changed, which is the good news and also the thing a customer
 * will not believe unless it is said, and the number that did change is the
 * end date.
 *
 * Falls back to `customer.voucher_ready` when the renewal template has not
 * been configured at /superadmin/emails. An unconfigured template is a
 * silent skip everywhere else in this app, and that is right for a
 * notification - but this one is the receipt for money that just moved, and
 * adding a new email key must not be the reason a paying customer hears
 * nothing. The fallback carries the same credentials; it just does not
 * mention the new date.
 */
export async function notifyVoucherRenewed(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  username: string;
  password: string;
  duration: string;
  dataLimit?: string | null;
  sharedUsers?: string | null;
  amountKobo: number;
  reference: string;
  expiresAt: Date;
  /**
   * The tenant's renewal settings, which decide one sentence of this
   * email. Under the defaults it says what it always said; under either
   * reset mode the old wording ("whatever time and data you had left has
   * been added on top") would be a plain untruth about money that has just
   * moved.
   */
  modes?: RenewalModes;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  const modes = params.modes ?? DEFAULT_RENEWAL_MODES;

  // Two short sentences rather than one of four shapes: the time rule and
  // the data rule are independent settings, and a tenant who resets one and
  // carries the other is an ordinary configuration.
  const sentences = [
    modes.expiry === "reset"
      ? "Your time starts again from now."
      : "Whatever time you had left has been added on top.",
  ];
  // Nothing useful to say about an allowance the plan does not impose.
  const capped = Boolean(
    params.dataLimit && params.dataLimit.toLowerCase() !== "unlimited"
  );
  if (capped) {
    sentences.push(
      modes.data === "reset"
        ? "Your data allowance has been reset."
        : "Any data you had left has been carried over."
    );
  }
  const renewalNote = sentences.join(" ");

  const shared = {
    customer_email: params.customerEmail,
    business_name: tenant?.businessName ?? "",
    plan_name: params.planName,
    location_name: params.locationName,
    voucher_username: params.username,
    voucher_password: params.password,
    duration: params.duration,
    data_limit: params.dataLimit || "Unlimited",
    devices: formatDeviceCount(params.sharedUsers) ?? "Not specified",
    amount: formatNaira(params.amountKobo),
    reference: params.reference,
    portal_url: tenant?.portalUrl ?? "",
  };

  const outcome = await sendEmail("customer.voucher_renewed", {
    to: params.customerEmail,
    variables: {
      ...shared,
      renewal_note: renewalNote,
      expires_at: params.expiresAt.toLocaleString("en-NG", {
        timeZone: DISPLAY_TIME_ZONE,
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
    },
  });

  // Only these two reasons. A send that failed at Mailtrap, or an address
  // we could not use, would fail the same way twice, and a second attempt
  // would just be a second entry in the log.
  if (
    !outcome.sent &&
    (outcome.reason === "no-content" || outcome.reason === "disabled")
  ) {
    await sendEmail("customer.voucher_ready", {
      to: params.customerEmail,
      variables: shared,
    });
  }
}

export async function notifyVoucherPending(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  amountKobo: number;
  reference: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  await sendEmail("customer.voucher_pending", {
    to: params.customerEmail,
    variables: {
      customer_email: params.customerEmail,
      business_name: tenant?.businessName ?? "",
      plan_name: params.planName,
      location_name: params.locationName,
      amount: formatNaira(params.amountKobo),
      reference: params.reference,
    },
  });
}

export async function notifyVoucherActivated(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  username: string;
  password: string;
  duration: string;
  dataLimit?: string | null;
  sharedUsers?: string | null;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  await sendEmail("customer.voucher_activated", {
    to: params.customerEmail,
    variables: {
      customer_email: params.customerEmail,
      business_name: tenant?.businessName ?? "",
      plan_name: params.planName,
      location_name: params.locationName,
      voucher_username: params.username,
      voucher_password: params.password,
      duration: params.duration,
      data_limit: params.dataLimit || "Unlimited",
      devices: formatDeviceCount(params.sharedUsers) ?? "Not specified",
      portal_url: tenant?.portalUrl ?? "",
    },
  });
}

export async function notifyVoucherExpiring(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  expiresAt: Date;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  await sendEmail("customer.voucher_expiring", {
    to: params.customerEmail,
    variables: {
      customer_email: params.customerEmail,
      business_name: tenant?.businessName ?? "",
      plan_name: params.planName,
      expires_at: params.expiresAt.toLocaleString("en-NG", {
        timeZone: DISPLAY_TIME_ZONE,
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      }),
      portal_url: tenant?.portalUrl ?? "",
    },
  });
}

// --------------------------------------------------------------------- owner

/**
 * A sale that worked.
 *
 * The counterweight to notifyOwnerVoucherFailed. Before this existed an
 * owner only ever heard from the platform when something went wrong, which
 * is a poor relationship with the software running your business.
 *
 * `tenantShareKobo` can be null on a sale whose split is not known (one from
 * before Knomad Pay with none reported). Null means genuinely unknown and
 * the template is given an empty string, never a zero - a zero here reads as
 * "you earned nothing from this sale", which would be a lie about money.
 */
export async function notifyOwnerVoucherSold(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  amountKobo: number;
  tenantShareKobo: number | null;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.voucher_sold", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      customer_email: params.customerEmail,
      plan_name: params.planName,
      location_name: params.locationName,
      amount: formatNaira(params.amountKobo),
      tenant_share:
        params.tenantShareKobo === null
          ? ""
          : formatNaira(params.tenantShareKobo),
      vouchers_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/vouchers")),
    },
  });
}

/**
 * One summary instead of one email per sale.
 *
 * Sent only for a period that actually had sales: a daily "you sold nothing"
 * email is how a sender gets muted, and muting this address would also bury
 * the failure alerts that share it.
 */
export async function notifyOwnerSalesDigest(params: {
  tenantId: string;
  period: string;
  voucherCount: number;
  grossKobo: number;
  tenantShareKobo: number | null;
  /** One line per location, already formatted for the template. */
  locationBreakdown: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.sales_digest", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      period: params.period,
      voucher_count: String(params.voucherCount),
      gross_amount: formatNaira(params.grossKobo),
      tenant_share:
        params.tenantShareKobo === null
          ? ""
          : formatNaira(params.tenantShareKobo),
      location_breakdown: params.locationBreakdown,
      vouchers_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/vouchers")),
    },
  });
}

export async function notifyOwnerVoucherFailed(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  failureReason: string;
  amountKobo: number;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.voucher_failed", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      customer_email: params.customerEmail,
      plan_name: params.planName,
      location_name: params.locationName,
      failure_reason: params.failureReason,
      amount: formatNaira(params.amountKobo),
      failed_queue_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/failed")),
    },
  });
}

export async function notifyLimitApproaching(
  tenantId: string,
  limitType: PlanLimitType,
  currentCount: number,
  limitValue: number
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.limit_approaching", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      limit_type: LIMIT_LABELS[limitType],
      current_count: String(currentCount),
      limit_value: String(limitValue),
      plan_name: tenant.planName,
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

export async function notifyLimitReached(
  tenantId: string,
  limitType: PlanLimitType,
  limitValue?: number
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.limit_reached", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      limit_type: LIMIT_LABELS[limitType],
      limit_value: limitValue !== undefined ? String(limitValue) : "",
      plan_name: tenant.planName,
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * What a new owner is actually billed, as one sentence.
 *
 * Built here rather than in the template because the template cannot branch:
 * a Mailtrap body renders whatever rows it declares, so a conditional line
 * would have to be an empty one. One variable that always says something
 * true is the version that cannot render as a blank next to a label.
 *
 * The fee shown alongside this is always the plan's real price. Showing the
 * discounted figure as "Monthly fee" is what made the first version of this
 * email read as though a 3,000 naira plan cost nothing.
 */
export function billingNote(params: {
  planFeeKobo: number;
  discountKobo: number;
  discountEndsAt: Date | null;
  couponCode: string | null;
}): string {
  const fee = formatNaira(params.planFeeKobo);

  if (params.planFeeKobo === 0) return "This plan has no monthly fee.";
  if (params.discountKobo === 0) return `${fee} a month, charged monthly.`;

  const code = params.couponCode ? ` with code ${params.couponCode}` : "";
  const until = params.discountEndsAt
    ? params.discountEndsAt.toLocaleDateString("en-NG", {
        timeZone: DISPLAY_TIME_ZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  if (params.discountKobo >= params.planFeeKobo) {
    return until
      ? `Free until ${until}${code}. ${fee} a month after that.`
      : `Waived${code}. Normally ${fee} a month.`;
  }

  const off = formatNaira(params.discountKobo);
  return until
    ? `${off} off your first payment${code}. ${fee} a month from ${until}.`
    : `${off} off your first payment${code}. ${fee} a month after that.`;
}

export async function notifyOwnerWelcome(params: {
  tenantId: string;
  ownerEmail: string;
  businessName: string;
  slug: string;
  planName: string;
  /** The plan's real price, never the discounted one. */
  monthlyFeeKobo: number;
  discountKobo?: number;
  discountEndsAt?: Date | null;
  couponCode?: string | null;
}): Promise<void> {
  await sendEmail("owner.welcome", {
    to: params.ownerEmail,
    tenantId: params.tenantId,
    variables: {
      owner_email: params.ownerEmail,
      business_name: params.businessName,
      slug: params.slug,
      plan_name: params.planName,
      monthly_fee: formatNaira(params.monthlyFeeKobo),
      billing_note: billingNote({
        planFeeKobo: params.monthlyFeeKobo,
        discountKobo: params.discountKobo ?? 0,
        discountEndsAt: params.discountEndsAt ?? null,
        couponCode: params.couponCode ?? null,
      }),
      portal_url: absoluteUrl(tenantUrl(params.slug)),
      admin_url: absoluteUrl(tenantUrl(params.slug, "/admin")),
    },
  });
}

/**
 * A receipt for a plan period just paid (lib/billing-charges.ts), with the date it is
 * paid until. The email key is from the Paystack subscription days, kept so its
 * configured Mailtrap template carries on.
 */
export async function notifyPlanPaid(
  tenantId: string,
  nextBillingDate: Date,
  amountKobo?: number
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.subscription_renewed", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      amount: formatNaira(amountKobo ?? tenant.monthlyFee),
      next_billing_date: nextBillingDate.toLocaleDateString("en-NG", {
        timeZone: DISPLAY_TIME_ZONE,
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * A receipt for an addon or credits, from the one call that applied the
 * payment (lib/billing-charges.ts), however many raced to. `detail` says what
 * the owner has now: the paid-until date, or the new credit balance.
 */
export async function notifyPurchaseReceived(
  tenantId: string,
  purchase: { item: string; amountKobo: number; detail: string; path: string }
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.purchase_received", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      item: purchase.item,
      amount: formatNaira(purchase.amountKobo),
      detail: purchase.detail,
      action_url: absoluteUrl(tenantUrl(tenant.slug, purchase.path)),
    },
  });
}

/**
 * The tenant's payout account was changed (lib/payout-account.ts). Every time: a change
 * the owner did not make is how their money would be taken.
 */
export async function notifyPayoutAccountChanged(params: {
  tenantId: string;
  bankName: string;
  accountLast4: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.payout_account_changed", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      bank_name: params.bankName,
      account_last4: params.accountLast4,
      settings_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * A paid month of an addon is about to run out. Sent once per period, a few days out,
 * from the plan-fee-due cron: nothing renews by itself.
 */
export async function notifyAddonRenewalDue(params: {
  tenantId: string;
  addonName: string;
  amountKobo: number;
  endsAt: Date;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.addon_renewal_due", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      addon_name: params.addonName,
      amount: formatNaira(params.amountKobo),
      ends_at: emailDay(params.endsAt),
      addons_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/addons")),
    },
  });
}

/**
 * The plan fee is next owed in a few days: a waiver closing, or a paid month running
 * out. Sent once for each, a few days out.
 *
 * Reads the fee from the tenant's own snapshot rather than the live plan,
 * because that snapshot is what they will actually be charged.
 */
export async function notifyPlanFeeEnding(params: {
  tenantId: string;
  endsAt: Date;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  const { planFeeGraceDays } = await getPlatformConfig();

  await sendEmail("owner.plan_fee_ending", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      monthly_fee: formatNaira(tenant.monthlyFee),
      ends_at: emailDay(params.endsAt),
      // Rendered as a phrase rather than a bare number, because the
      // sentence it lands in reads badly either way round otherwise, and
      // "1 days" is the kind of thing nobody notices until a customer
      // screenshots it.
      grace_days: describeGraceDays(planFeeGraceDays),
      settings_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * A waiver has closed, or a paid month has run out, and the fee is owed.
 *
 * `locksAt` is passed in rather than re-resolved: the cron has already
 * computed the whole plan-fee state to decide this was worth sending, and
 * reading it twice is how the date in the email ends up a tick away from the
 * date that is actually enforced.
 */
export async function notifyPlanFeeDue(
  tenantId: string,
  locksAt: Date | null
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.plan_fee_due", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      monthly_fee: formatNaira(tenant.monthlyFee),
      // Never blank. An empty date in "new sales pause on ___" is worse
      // than no sentence at all, and a null here would mean the grace
      // window could not be resolved - in which case the honest thing is to
      // say it is imminent rather than to invent a day.
      locks_at: locksAt ? emailDay(locksAt) : "shortly",
      settings_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * The grace window has run out and new sales have stopped.
 *
 * The only one of the three that reports something already done, which is
 * exactly why it must never be the first an owner hears of this - see
 * `runPlanFeeDue`, which sends all three from the same job for that reason.
 */
export async function notifyPlanFeeLocked(
  tenantId: string,
  lockedSince: Date
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.plan_fee_locked", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      monthly_fee: formatNaira(tenant.monthlyFee),
      locked_since: emailDay(lockedSince),
      settings_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

export async function notifyTenantStatusChanged(
  tenantId: string,
  status: "suspended" | "active"
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  if (status === "suspended") {
    await sendEmail("owner.account_suspended", {
      to: tenant.ownerEmail,
      tenantId: tenant.id,
      variables: {
        owner_email: tenant.ownerEmail ?? "",
        business_name: tenant.businessName,
      },
    });
    return;
  }

  await sendEmail("owner.account_reactivated", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      portal_url: tenant.portalUrl,
    },
  });
}

export async function notifyRouterOffline(params: {
  tenantId: string;
  routerName: string;
  locationName?: string | null;
  lastSeen: Date | null;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.router_offline", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      router_name: params.routerName,
      location_name: params.locationName ?? "",
      last_seen: params.lastSeen
        ? params.lastSeen.toLocaleString("en-NG", {
        timeZone: DISPLAY_TIME_ZONE,
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
          })
        : "Unknown",
    },
  });
}

/**
 * Customers with a plan still running whose login has gone from the router,
 * with nothing on record removing it. Sent once per login, on the moment
 * router-health first notices (lib/missing-logins.ts), and one email per
 * router per tick however many went at once.
 */
export async function notifyLoginsMissing(params: {
  tenantId: string;
  routerName: string;
  locationId: string;
  locationName: string;
  usernames: string[];
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  const count = params.usernames.length;
  await sendEmail("owner.logins_missing", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      router_name: params.routerName,
      location_name: params.locationName,
      missing_count: count === 1 ? "1 customer" : `${count} customers`,
      missing_list: missingLoginList(params.usernames),
      users_url: absoluteUrl(
        tenantUrl(
          tenant.slug,
          `/admin/users?location=${encodeURIComponent(params.locationId)}`
        )
      ),
    },
  });
}

// ------------------------------------------------------------------ platform

/**
 * Yesterday across the whole platform, for whoever runs it.
 *
 * Deliberately two halves, and the second is the point. Revenue is pleasant
 * but it is not actionable; `attention` is the list of things that will stay
 * broken until a person looks. An unfulfilled payment sat unnoticed for a
 * full day once because nothing on the platform ever volunteered that
 * something had gone wrong.
 *
 * Sent every day, including quiet ones, unlike the tenant digest. A silent
 * day here is itself information: it means nothing needed attention, and an
 * operator who stops receiving it learns the job has stopped running.
 */
export async function notifyPlatformDailyDigest(params: {
  period: string;
  voucherCount: number;
  grossKobo: number;
  platformRevenueKobo: number;
  tenantCount: number;
  /** One line per tenant that sold something. */
  tenantBreakdown: string;
  /** What needs a human, already formatted. "Nothing" when all is well. */
  attention: string;
}): Promise<void> {
  await sendEmail("platform.daily_digest", {
    to: await platformRecipients(),
    variables: {
      period: params.period,
      voucher_count: String(params.voucherCount),
      gross_amount: formatNaira(params.grossKobo),
      platform_revenue: formatNaira(params.platformRevenueKobo),
      tenant_count: String(params.tenantCount),
      tenant_breakdown: params.tenantBreakdown || "No sales yesterday.",
      attention: params.attention,
      superadmin_url: absoluteUrl("/superadmin"),
    },
  });
}

export async function notifyPlatformNewTenant(params: {
  businessName: string;
  slug: string;
  ownerEmail: string;
  planName: string;
  monthlyFeeKobo: number;
}): Promise<void> {
  await sendEmail("platform.new_tenant", {
    to: await platformRecipients(),
    variables: {
      business_name: params.businessName,
      slug: params.slug,
      owner_email: params.ownerEmail,
      plan_name: params.planName,
      monthly_fee: formatNaira(params.monthlyFeeKobo),
      tenant_admin_url: absoluteUrl(tenantUrl(params.slug, "/admin")),
    },
  });
}

export async function notifyPlatformSplitMismatch(params: {
  tenantId: string;
  reference: string;
  expectedKobo: number;
  receivedKobo: number;
  amountKobo: number;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);

  await sendEmail("platform.split_mismatch", {
    to: await platformRecipients(),
    variables: {
      business_name: tenant?.businessName ?? params.tenantId,
      reference: params.reference,
      expected_share: formatNaira(params.expectedKobo),
      received_share: formatNaira(params.receivedKobo),
      amount: formatNaira(params.amountKobo),
    },
  });
}

/**
 * A charge cleared and fulfilment could not honour it. The customer has been
 * told support is on it, so this email is the only thing that makes that
 * true: without it the money sits in a `paymentReviews` document nobody
 * reads. Sent once per reference, by the first caller to record it.
 */
export async function notifyPlatformPaymentReview(params: {
  /** Null for a signup's payment: there is no business yet. */
  tenantId: string | null;
  reference: string;
  kind: string;
  detail: string;
  amountKobo: number;
  chargedEmail: string;
}): Promise<void> {
  const tenant = params.tenantId ? await loadTenant(params.tenantId) : null;

  await sendEmail("platform.payment_review", {
    to: await platformRecipients(),
    variables: {
      business_name: tenant?.businessName ?? params.tenantId ?? "a new signup",
      reference: params.reference,
      reason: params.kind.replace(/_/g, " "),
      detail: params.detail,
      amount: formatNaira(params.amountKobo),
      customer_email: params.chargedEmail,
    },
  });
}

/**
 * A tenant's decision hook has failed ten times running and we have stopped
 * calling it. Sent once per trip, on the transition (lib/decision-hooks.ts
 * stamps it), never per failure. Operational, so it cannot be muted: for a
 * `block` hook this is the email that says sales have stopped.
 */
export async function notifyHookFailing(params: {
  tenantId: string;
  hookName: string;
  failStrategy: "block" | "allow";
  lastError: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.hook_failing", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      hook_name: params.hookName,
      effect:
        params.failStrategy === "block"
          ? "Your hook is set to block when it can't be reached, so customers can't buy the plans it covers until it answers again."
          : "Your hook is set to allow when it can't be reached, so purchases are going through without its check.",
      last_error: params.lastError.slice(0, 200),
      hooks_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/hooks")),
    },
  });
}

/** The same hook answered again and we have resumed calling it. */
export async function notifyHookRecovered(params: {
  tenantId: string;
  hookName: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.hook_recovered", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      hook_name: params.hookName,
      hooks_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/hooks")),
    },
  });
}

/**
 * A webhook endpoint went three days without accepting a delivery and we
 * switched it off. Sent once, on the transition (lib/webhooks.ts). Nothing
 * is lost: events stop, but the data is all still in the API.
 */
export async function notifyWebhookDisabled(params: {
  tenantId: string;
  url: string;
}): Promise<void> {
  const tenant = await loadTenant(params.tenantId);
  if (!tenant) return;

  await sendEmail("owner.webhook_disabled", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      endpoint_url: params.url,
      webhooks_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/webhooks")),
    },
  });
}

