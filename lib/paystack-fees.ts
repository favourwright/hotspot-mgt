import { PlatformConfig } from "@/types/schemas";

export type PaystackFeePassthroughConfig = PlatformConfig["paystackFeePassthrough"];

/**
 * Estimates what Paystack will deduct from a transaction of this amount, so
 * it can be added on top of the charge instead of eaten out of a settlement.
 *
 * This is an ESTIMATE against Paystack's published local-card schedule -
 * there's no API to ask Paystack the exact fee in advance, and the real fee
 * genuinely varies by channel (local card, international card, bank
 * transfer) in ways we can't know until the customer picks one at checkout.
 * That's fine: see docs/billing-and-payments.md for why any gap between
 * this estimate and Paystack's real fee is designed to cost the platform a
 * little margin, never the tenant's payout.
 */
export function estimatePaystackFee(
  amountKobo: number,
  config: PaystackFeePassthroughConfig
): number {
  if (!config.enabled || amountKobo <= 0) return 0;

  let fee = Math.round((amountKobo * config.percent) / 100);

  if (amountKobo > config.waiveFlatFeeBelowKobo) {
    fee += config.flatFeeKobo;
  }

  if (config.capKobo > 0) {
    fee = Math.min(fee, config.capKobo);
  }

  return fee;
}
