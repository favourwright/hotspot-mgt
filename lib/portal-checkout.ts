import { getPlatformConfig } from "@/lib/platform-config";
import { estimateProcessingFee } from "@/lib/processing-fees";
import type { Plan, Tenant } from "@/types/schemas";

/**
 * What each plan costs at the captive portal, computed on the server while the page
 * renders: the price, plus the processing fee when the platform passes it on.
 *
 * Computed here, inline, because the page has to show a price before anyone has signed
 * in, and a real-money endpoint widened to unauthenticated callers would be the wrong
 * trade. It is only what the button says: the charge itself is worked out again by
 * /api/purchase/initiate, which is the only place one starts.
 *
 * The customer limit is deliberately not decided here. This runs with no idea who is
 * looking, so all it could say is "this network is full", which turned away the existing
 * customers the limit exempts. The checkout dialog asks can-purchase, which knows the
 * buyer.
 */
export interface PortalCheckoutConfig {
  /** Charge per plan id, in kobo, the passed-on fee included. */
  amounts: Record<string, number>;
}

export async function getPortalCheckoutConfig(
  _tenant: Tenant,
  plans: Plan[]
): Promise<PortalCheckoutConfig> {
  const { processingFeePassthrough } = await getPlatformConfig();
  const amounts: PortalCheckoutConfig["amounts"] = {};
  for (const plan of plans) {
    amounts[plan.id] = plan.price + estimateProcessingFee(plan.price, processingFeePassthrough);
  }
  return { amounts };
}
