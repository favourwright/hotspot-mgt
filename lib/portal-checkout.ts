import {
  getTenantCustomer,
  getTenantCustomerCount,
} from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import { guestUidForMac } from "@/lib/guest-identity";
import type { Plan, Tenant } from "@/types/schemas";

/**
 * Everything the captive portal's checkout needs to open Paystack, computed
 * on the server while the page renders.
 *
 * This exists instead of letting the portal call /api/tenant/[slug]/
 * checkout-amount and /can-purchase: both of those are authenticated, and a
 * guest standing on the paywall has no token to send. Rather than widening
 * two real-money endpoints to unauthenticated callers, the portal page --
 * which is already a server component holding the tenant and its plans --
 * does the same work inline. The numbers stay server-computed and
 * authoritative, and /api/payment/verify recomputes the expected amount from
 * scratch anyway before issuing a voucher.
 */
export interface PortalCheckoutConfig {
  /** Charge per plan id, in kobo, fee-passthrough already applied. */
  amounts: Record<string, { amount: number; transactionCharge: number | null }>;
  paystackBearer: "account" | "subaccount";
  subaccountCode: string | null;
  /** Null when plans can be bought; a message to show instead when they can't. */
  blockedReason: string | null;
}

export async function getPortalCheckoutConfig(
  tenant: Tenant,
  plans: Plan[],
  deviceMac: string | null
): Promise<PortalCheckoutConfig> {
  const platformConfig = await getPlatformConfig();

  const amounts: PortalCheckoutConfig["amounts"] = {};
  for (const plan of plans) {
    const fee = estimatePaystackFee(
      plan.price,
      platformConfig.paystackFeePassthrough
    );
    // Mirrors /api/tenant/[slug]/checkout-amount exactly: only override the
    // split when there's a fee to protect the tenant's share from.
    amounts[plan.id] = {
      amount: plan.price + fee,
      transactionCharge:
        fee > 0 && tenant.paystackSubaccountCode
          ? Math.round((plan.price * tenant.platformFeePercent) / 100) + fee
          : null,
    };
  }

  return {
    amounts,
    paystackBearer: platformConfig.paystackBearer,
    subaccountCode: tenant.paystackSubaccountCode ?? null,
    blockedReason: await customerLimitBlock(tenant, deviceMac),
  };
}

/**
 * The same maxCustomers enforcement /api/tenant/[slug]/can-purchase does,
 * applied before the portal renders a Buy button. A device that has already
 * bought here is an existing customer and always passes.
 */
async function customerLimitBlock(
  tenant: Tenant,
  deviceMac: string | null
): Promise<string | null> {
  const billingPlan = await getBillingPlanById(tenant.planId);
  const maxCustomers = billingPlan?.limits.maxCustomers ?? null;
  if (maxCustomers === null) return null;

  if (deviceMac) {
    const existing = await getTenantCustomer(tenant.id, guestUidForMac(deviceMac));
    if (existing) return null;
  }

  const currentCount = await getTenantCustomerCount(tenant.id);
  if (currentCount >= maxCustomers) {
    return "This network isn't accepting new customers right now. Please check back later.";
  }

  return null;
}
