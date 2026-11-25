import { resolvePaystackBearer } from "@/lib/billing-plans";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee, computeCheckoutSplit } from "@/lib/paystack-fees";
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
 *
 * The customer limit is deliberately not decided here. This runs with no idea
 * who is looking, so all it could say is "this network is full", which turned
 * away the existing customers the limit exempts. The checkout dialog asks
 * can-purchase, which knows the buyer.
 */
export interface PortalCheckoutConfig {
  /** Charge per plan id, in kobo, fee-passthrough already applied. */
  amounts: Record<string, { amount: number; transactionCharge: number | null }>;
  paystackBearer: "account" | "subaccount";
  subaccountCode: string | null;
  /** Which gateway this tenant's checkout goes through (see lib/knomad-pay.ts). */
  gateway: "paystack" | "knomadpay";
}

export async function getPortalCheckoutConfig(
  tenant: Tenant,
  plans: Plan[]
): Promise<PortalCheckoutConfig> {
  const platformConfig = await getPlatformConfig();

  // Resolved once, not per plan: it depends on the tenant's billing plan,
  // not on which voucher plan is being bought.
  const bearer = await resolvePaystackBearer(tenant.planId);

  const amounts: PortalCheckoutConfig["amounts"] = {};
  for (const plan of plans) {
    const fee = estimatePaystackFee(
      plan.price,
      platformConfig.paystackFeePassthrough
    );
    // The same function /api/tenant/[slug]/checkout-amount uses, so the two
    // cannot drift.
    amounts[plan.id] = computeCheckoutSplit({
      priceKobo: plan.price,
      feeKobo: fee,
      platformFeePercent: tenant.platformFeePercent,
      bearer,
      hasSubaccount: Boolean(tenant.paystackSubaccountCode),
    });
  }

  return {
    amounts,
    // The tenant's plan decides this, falling back to the platform default.
    paystackBearer: bearer,
    subaccountCode: tenant.paystackSubaccountCode ?? null,
    gateway: tenant.paymentGateway ?? "paystack",
  };
}
