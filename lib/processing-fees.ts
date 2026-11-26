/**
 * The payment provider's processing fee, and how a voucher sale divides.
 *
 * Two platform settings decide them (`/superadmin/config`, and per plan for the bearer):
 *
 *  - `processingFeePassthrough`: whether the buyer pays an estimate of the provider's
 *    fee on top of the price, and the formula for it. Off, the price is what is charged.
 *  - `feeBearer`: who the provider takes its real fee from on a split sale, the platform
 *    (out of its share) or the tenant (out of theirs). A plan can override the platform's.
 *
 * Kept pure so `npm run test:processing-fees` can walk it.
 */
import type { PlatformConfig } from "@/types/schemas";

export type ProcessingFeeConfig = PlatformConfig["processingFeePassthrough"];
export type FeeBearer = "platform" | "tenant";

/** The estimated fee passed on to the buyer for a price, or 0 when passthrough is off. */
export function estimateProcessingFee(amountKobo: number, config: ProcessingFeeConfig): number {
  if (!config.enabled || amountKobo <= 0) return 0;
  let fee = Math.round((amountKobo * config.percent) / 100);
  if (amountKobo > config.waiveFlatFeeBelowKobo) fee += config.flatFeeKobo;
  if (config.capKobo > 0) fee = Math.min(fee, config.capKobo);
  return fee;
}

/**
 * How a voucher sale divides, as Knomad Pay is told to split it: the tenant's share as a
 * flat amount, so it is exact whatever the provider's fee turns out to be.
 *
 * The platform keeps its commission on the price, plus the passed-on fee when the
 * platform is the one the provider takes its fee from; the tenant gets the rest. When
 * the tenant bears the fee, the provider takes it from their share, so the passed-on fee
 * stays with them to cover it.
 */
export function saleShares(input: {
  amountKobo: number;
  priceKobo: number;
  feeKobo: number;
  platformFeePercent: number;
  bearer: FeeBearer;
}): { platformShareKobo: number; tenantShareKobo: number } {
  const commission = Math.round((input.priceKobo * input.platformFeePercent) / 100);
  const platformShareKobo = commission + (input.bearer === "platform" ? input.feeKobo : 0);
  return { platformShareKobo, tenantShareKobo: input.amountKobo - platformShareKobo };
}
