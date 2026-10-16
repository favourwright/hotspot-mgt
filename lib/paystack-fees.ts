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

/**
 * What to charge the customer, and what to send to the platform's own
 * account out of it.
 *
 * One function rather than the same arithmetic in both checkout paths,
 * because they have to agree: the storefront and the captive portal sell the
 * same plan, and a split that differs between them is money moving
 * differently depending on which page the buyer happened to be on.
 *
 * `transactionCharge` is Paystack's per-transaction override of the split:
 * the amount routed to the main account, with the rest going to the
 * subaccount. Null means send no override at all and let the subaccount's
 * stored `percentage_charge` decide, which is how this has always worked
 * with fee-passthrough off.
 *
 * The bearer is why the fee is conditional. Passthrough adds Paystack's
 * estimated fee to what the customer pays; who that money is meant to
 * reimburse depends on who Paystack will take its real fee from. With
 * `account`, the platform is about to be charged, so it collects the fee.
 * With `subaccount`, the tenant is - so routing the fee to the platform as
 * well would charge for it twice, once from the customer and once out of
 * the tenant's payout. On a comped plan that is pure platform margin on an
 * account meant to pay nothing.
 */
export function computeCheckoutSplit(input: {
  /** The plan's listed price, in kobo. */
  priceKobo: number;
  /** Paystack's estimated fee, already computed. Zero when passthrough is off. */
  feeKobo: number;
  /** The tenant's commission rate, as a whole percent. */
  platformFeePercent: number;
  /** Who absorbs Paystack's own fee. */
  bearer: "account" | "subaccount";
  /** No subaccount means no split for Paystack to apply. */
  hasSubaccount: boolean;
}): { amount: number; transactionCharge: number | null } {
  const amount = input.priceKobo + input.feeKobo;

  // No fee means nothing to protect the tenant's share from, so send no
  // override at all and let the subaccount's stored percentage decide -
  // exactly as this worked before passthrough existed.
  //
  // This gate is load-bearing, not tidiness. `tenant.platformFeePercent`
  // and the subaccount's stored `percentage_charge` are set from the same
  // value at signup and nothing keeps them in step afterwards (see
  // docs/billing-and-payments.md). Overriding on every charge would make
  // the Firestore field authoritative, silently moving money for any tenant
  // whose plan was edited after they joined.
  if (!input.hasSubaccount || input.feeKobo === 0) {
    return { amount, transactionCharge: null };
  }

  const commission = Math.round(
    (input.priceKobo * input.platformFeePercent) / 100
  );
  const charge = commission + (input.bearer === "account" ? input.feeKobo : 0);

  // Never send a zero. Paystack's own docs do not settle whether a
  // `transaction_charge` of 0 overrides the subaccount percentage or reads
  // as unset, and the two differ by the whole commission. Omitting it falls
  // back to the stored percentage, which for a comped tenant is 0 anyway.
  return { amount, transactionCharge: charge > 0 ? charge : null };
}

/**
 * What the tenant's subaccount should receive from a split charge.
 *
 * Derived from the same `computeCheckoutSplit` that decided what to send, so
 * the expectation and the instruction cannot drift apart - the two used to be
 * separate arithmetic in separate files, which is how this went wrong.
 *
 * The term that was missing is Paystack's own fee. It comes out of whichever
 * side the `bearer` names, so a tenant on a plan that makes them bear it
 * receives exactly that much less. With the old formula - price minus the
 * platform's percentage, and nothing else - a comped tenant on `subaccount`
 * produced a "split mismatch" alert on every single sale, for a split that
 * was behaving exactly as configured.
 */
export function expectedTenantShareKobo(input: {
  /** What Paystack actually charged, fee passthrough included. */
  chargedKobo: number;
  priceKobo: number;
  feeKobo: number;
  platformFeePercent: number;
  bearer: "account" | "subaccount";
  /** What Paystack reported taking. Null when it reported nothing. */
  paystackFeeKobo: number | null;
}): number {
  const { transactionCharge } = computeCheckoutSplit({
    priceKobo: input.priceKobo,
    feeKobo: input.feeKobo,
    platformFeePercent: input.platformFeePercent,
    bearer: input.bearer,
    hasSubaccount: true,
  });

  // Null means no per-charge override was sent, so Paystack applied the
  // subaccount's stored percentage - which is set from this same field.
  const platformCut =
    transactionCharge ??
    Math.round((input.priceKobo * input.platformFeePercent) / 100);

  const borneByTenant =
    input.bearer === "subaccount" ? (input.paystackFeeKobo ?? 0) : 0;

  return input.chargedKobo - platformCut - borneByTenant;
}
