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
import { absoluteUrl, platformRecipients, sendEmail } from "@/lib/email";
import { tenantUrl } from "@/lib/tenant-url";
import { formatNaira } from "@/lib/utils";

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

export async function notifyVoucherReady(params: {
  tenantId: string;
  customerEmail: string;
  planName: string;
  locationName: string;
  username: string;
  password: string;
  duration: string;
  dataLimit?: string | null;
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
      portal_url: tenant?.portalUrl ?? "",
    },
  });
}

// --------------------------------------------------------------------- owner

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
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      plan_name: tenant.planName,
      billing_url: absoluteUrl(tenantUrl(tenant.slug, "/admin/settings")),
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
      variables: {
        owner_email: tenant.ownerEmail ?? "",
        business_name: tenant.businessName,
      },
    });
    return;
  }

  await sendEmail("owner.account_reactivated", {
    to: tenant.ownerEmail,
    variables: {
      owner_email: tenant.ownerEmail ?? "",
      business_name: tenant.businessName,
      portal_url: tenant.portalUrl,
    },
  });
}

// ------------------------------------------------------------------ platform

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
