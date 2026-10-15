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
import { formatDeviceCount, formatNaira } from "@/lib/utils";

export type PlanLimitType = "maxCustomers" | "maxLocations" | "maxRouters";

const LIMIT_LABELS: Record<PlanLimitType, string> = {
  maxCustomers: "customers",
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
 * Most call sites hold a tenantId and nothing else - a webhook only ever has
 * a Paystack customer code resolved to one. Returns null rather than throwing
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
 * `tenantShareKobo` can be null: Paystack sometimes names a subaccount and
 * reports no `fees_split` for the charge. Null means genuinely unknown and
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

export async function notifyOwnerWelcome(params: {
  tenantId: string;
  ownerEmail: string;
  businessName: string;
  slug: string;
  planName: string;
  monthlyFeeKobo: number;
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
      portal_url: absoluteUrl(tenantUrl(params.slug)),
      admin_url: absoluteUrl(tenantUrl(params.slug, "/admin")),
    },
  });
}

export async function notifySubscriptionPaymentFailed(
  tenantId: string,
  amountKobo?: number
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.subscription_payment_failed", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      amount: formatNaira(amountKobo ?? tenant.monthlyFee),
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

export async function notifySubscriptionRenewed(
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
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

export async function notifySubscriptionCancelled(
  tenantId: string
): Promise<void> {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return;

  await sendEmail("owner.subscription_cancelled", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/**
 * The waiver is about to close. Sent once, a few days out.
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

  await sendEmail("owner.plan_fee_ending", {
    to: tenant.ownerEmail,
    tenantId: tenant.id,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      monthly_fee: formatNaira(tenant.monthlyFee),
      ends_at: params.endsAt.toLocaleDateString("en-NG", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      settings_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
    },
  });
}

/** The waiver has closed and the fee is owed again. */
export async function notifyPlanFeeDue(tenantId: string): Promise<void> {
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
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
          })
        : "Unknown",
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
