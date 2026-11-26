/**
 * Knomad Pay: Knomad's own payment gateway, which holds the Monnify keys and calls
 * Monnify for every Knomad app (the knomad-pay repo). This app holds only its own API key
 * and the secret Knomad Pay signs its events with. Talks to it through
 * @favourwright/knomad-pay-client.
 *
 * Knomad Pay checks every payment with Monnify (reference, currency, amount asked and
 * paid) before it calls it succeeded, keeps the provider's references, retries and
 * reconciles; this file only asks it, and turns its answers into this app's terms.
 */

import {
  createKnomadPayClient,
  type Charge,
  type KnomadPayClient,
  type SplitInput,
} from "@favourwright/knomad-pay-client";
import { saleShares, type FeeBearer } from "@/lib/processing-fees";

/**
 * A charge as fulfilment, payment reviews and billing read it: successful only once Knomad
 * Pay has checked it with Monnify.
 */
export interface VerifiedCharge {
  success: boolean;
  data?: {
    reference: string;
    /** Kobo. */
    amount: number;
    currency: string;
    status: "success";
    customerEmail: string;
    metadata?: Record<string, unknown>;
    paidAt: string;
    /** A voucher sale's split, as it was instructed: the tenant's payee and both shares. */
    split?: {
      payeeReference: string;
      tenantShareKobo: number;
      platformShareKobo: number;
    };
  };
  error?: string;
}

let client: KnomadPayClient | null = null;

/** Whether this deployment can reach Knomad Pay at all. */
export function knomadPayConfigured(): boolean {
  return Boolean(process.env.KNOMAD_PAY_URL && process.env.KNOMAD_PAY_API_KEY);
}

export function knomadPay(): KnomadPayClient {
  if (client) return client;
  if (!knomadPayConfigured()) {
    throw new Error("Knomad Pay is not configured: KNOMAD_PAY_URL and KNOMAD_PAY_API_KEY");
  }
  client = createKnomadPayClient({
    baseUrl: process.env.KNOMAD_PAY_URL!,
    apiKey: process.env.KNOMAD_PAY_API_KEY!,
  });
  return client;
}

/** For tests: use this client instead of one built from the env. */
export function setKnomadPayClient(next: KnomadPayClient | null): void {
  client = next;
}

/**
 * How a voucher sale is split at Knomad Pay: the tenant's share, flat, to their payee
 * (`saleShares`, lib/processing-fees.ts). Null when there is nothing to send them.
 */
export function knomadPaySplit(input: {
  amountKobo: number;
  priceKobo: number;
  feeKobo: number;
  platformFeePercent: number;
  bearer: FeeBearer;
  payeeReference: string | null;
}): { split: SplitInput; tenantShareKobo: number; platformShareKobo: number } | null {
  if (!input.payeeReference) return null;
  const { platformShareKobo, tenantShareKobo } = saleShares(input);
  if (tenantShareKobo <= 0) return null;
  return {
    split: {
      payees: [{ payee: input.payeeReference, share: { amountKobo: tenantShareKobo } }],
      feeBearer: input.bearer === "tenant" ? input.payeeReference : "platform",
    },
    tenantShareKobo,
    platformShareKobo,
  };
}

/** A Knomad Pay charge as a `VerifiedCharge`: successful only when Knomad Pay says so. */
export function toVerifiedCharge(charge: Charge): VerifiedCharge {
  if (charge.status !== "succeeded") {
    return { success: false, error: `Payment status is ${charge.status}, not succeeded` };
  }
  const payee = charge.split?.payees[0];
  return {
    success: true,
    data: {
      reference: charge.reference,
      amount: charge.amountKobo,
      currency: charge.currency,
      status: "success",
      customerEmail: charge.customer.email,
      metadata: charge.metadata,
      paidAt: charge.paidAt ?? charge.updatedAt,
      ...(payee
        ? {
            split: {
              payeeReference: payee.payee,
              tenantShareKobo: payee.amountKobo,
              platformShareKobo: charge.split!.platformKobo,
            },
          }
        : {}),
    },
  };
}

/**
 * Where Monnify's checkout sends the payer back to once they have paid: a page of ours
 * that tells the dialog around it which reference to verify. `billing` is a payment to
 * the platform (a plan period, an addon), which the page words differently.
 */
export function paymentReturnUrl(reference: string, purpose: "voucher" | "billing" = "voucher"): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  // Under /portal, a reserved slug, so no tenant's storefront can sit on this path.
  const url = `${base}/portal/payment-return?reference=${encodeURIComponent(reference)}`;
  return purpose === "billing" ? `${url}&for=billing` : url;
}

/** Asks Knomad Pay how a charge stands (it asks Monnify first unless it is final). */
export async function verifyKnomadPayCharge(reference: string): Promise<VerifiedCharge> {
  try {
    const result = await knomadPay().getCharge(reference);
    if (!result.ok) return { success: false, error: `Knomad Pay: ${result.code} ${result.message}` };
    return toVerifiedCharge(result.data);
  } catch (error) {
    return { success: false, error: `Knomad Pay did not answer: ${(error as Error).message}` };
  }
}
