import { getTenantCustomerCount } from "@/lib/firestore-helpers";
import { getBillingPlanById, resolvePaystackBearer } from "@/lib/billing-plans";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee } from "@/lib/paystack-fees";
import type { Plan, Tenant } from "@/types/schemas";

/**
 * Everything the captive portal's checkout needs to open Paystack, computed
 * on the server while the page renders.
 *
 * This exists instead of letting the portal call /api/tenant/[slug]/
 * checkout-amount at render time: the page has to show a price before anyone
 * has signed in, and widening a real-money endpoint to unauthenticated
 * callers to achieve that would be the wrong trade. The portal page is
 * already a server component holding the tenant and its plans, so it does
 * the same work inline. Buying itself is authenticated. The numbers stay server-computed and
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
  plans: Plan[]
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
    // The tenant's plan decides this, falling back to the platform default.
    paystackBearer: await resolvePaystackBearer(tenant.planId),
    subaccountCode: tenant.paystackSubaccountCode ?? null,
    blockedReason: await customerLimitBlock(tenant),
  };
}

/**
 * The same maxCustomers enforcement /api/tenant/[slug]/can-purchase does,
 * applied before the portal renders a Buy button.
 *
 * Deliberately coarse: this runs while the page renders, with no idea who is
 * looking, so it can only answer "is this network full for someone new". An
 * existing customer buying again is told apart from a new one by
 * can-purchase, which the checkout dialog calls with the buyer's token
 * before opening Paystack.
 *
 * This used to exempt a device whose MAC already had a customer record. That
 * could only ever match a guest purchase, and guests no longer exist.
 */
async function customerLimitBlock(tenant: Tenant): Promise<string | null> {
  const billingPlan = await getBillingPlanById(tenant.planId);
  const maxCustomers = billingPlan?.limits.maxCustomers ?? null;
  if (maxCustomers === null) return null;

  const currentCount = await getTenantCustomerCount(tenant.id);
  if (currentCount >= maxCustomers) {
    return "This network isn't accepting new customers right now. Please check back later.";
  }

  return null;
}
