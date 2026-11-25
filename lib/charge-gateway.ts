/**
 * Which gateway a voucher charge went through, and asking that one about it.
 *
 * A server-started checkout records its gateway on its pending purchase
 * (lib/pending-purchases.ts). Everything that later asks "did this reference pay?"
 * (fulfilment, payment reviews) comes through here, so it asks the gateway that took
 * the money. A reference with no record, or a record from before Knomad Pay, is
 * Paystack's, as every charge was until then.
 */

import { verifyKnomadPayCharge } from "@/lib/knomad-pay";
import { verifyPaystackPayment, type PaystackVerifyResult } from "@/lib/paystack";
import { getPendingPurchase } from "@/lib/pending-purchases";

export type ChargeGateway = "paystack" | "knomadpay";

export async function chargeGatewayOf(reference: string): Promise<ChargeGateway> {
  const pending = await getPendingPurchase(reference).catch(() => null);
  return pending?.gateway ?? "paystack";
}

/** Whether `reference` paid, in `verifyPaystackPayment`'s shape whichever gateway took it. */
export async function verifyCharge(reference: string): Promise<PaystackVerifyResult> {
  return (await chargeGatewayOf(reference)) === "knomadpay"
    ? verifyKnomadPayCharge(reference)
    : verifyPaystackPayment(reference);
}
