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
  ERRORS,
  type Charge,
  type KnomadPayClient,
  type SplitInput,
} from "@favourwright/knomad-pay-client";
import { saleShares, type FeeBearer } from "@/lib/processing-fees";
import { tenantUrl } from "@/lib/tenant-url";
import { standingOfCharge, UNKNOWN_STANDING, type PaymentStanding } from "@/lib/payment-standing";

/**
 * A charge as fulfilment, payment reviews and billing read it: successful only once Knomad
 * Pay has checked it with Monnify. When it is not, `standing` says how it stands instead
 * (lib/payment-standing.ts).
 */
export type VerifiedCharge =
  | {
      success: true;
      data: {
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
    }
  | { success: false; error: string; standing: PaymentStanding; data?: undefined };

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

type ChargeInput = Parameters<KnomadPayClient["createCharge"]>[0];

export type StartedCharge =
  | { ok: true; charge: Charge }
  | { ok: false; code: string; message: string; attempts: number };

/** How long one click may spend on a start, retries included, and the waits between tries. */
export const START_BUDGET_MS = 25_000;
const START_WAITS_MS = [1_000, 3_000];

/**
 * Starts a charge, and when Knomad Pay has no clear answer, sends the same request again:
 * the same reference, body and key. The gateway resumes the charge it began instead of
 * starting another, so a blip at Monnify costs a second, not a new reference and an
 * orphaned record (on 2026-11-27 seven clicks left seven). Which errors are worth trying
 * again comes from the gateway's own table (ERRORS[code].action === "retry"); not
 * reaching the gateway at all counts too. Gives up after the last wait or the budget,
 * and never throws.
 */
export async function startKnomadPayCharge(
  input: ChargeInput,
  options: { wait?: (ms: number) => Promise<void>; now?: () => number } = {}
): Promise<StartedCharge> {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const began = now();
  // The reference is new for every checkout, so it is the request's key too.
  const write = { idempotencyKey: `charge:${input.reference}` };
  for (let attempt = 1; ; attempt++) {
    const result = await knomadPay()
      .createCharge(input, write)
      .catch((error: Error) => ({ ok: false as const, status: 0, code: "UNREACHABLE", message: error.message }));
    if (result.ok) return { ok: true, charge: result.data };
    const retryable =
      result.code === "UNREACHABLE" ||
      result.code === "NO_ANSWER" ||
      ERRORS[result.code as keyof typeof ERRORS]?.action === "retry";
    const pause = START_WAITS_MS[attempt - 1];
    if (!retryable || pause === undefined || now() - began + pause > START_BUDGET_MS) {
      return { ok: false, code: result.code, message: result.message, attempts: attempt };
    }
    console.warn(`[knomad-pay] ${input.reference}: ${result.code} on try ${attempt}; same request again in ${pause / 1000}s`);
    await wait(pause);
  }
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
    return {
      success: false,
      error: `Payment status is ${charge.status}, not succeeded`,
      standing: standingOfCharge(charge.status, charge.checkoutUrl),
    };
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
 * Where Monnify's checkout sends the payer back to, once they have paid. Checkout is a
 * full page (the dialog leaves for it, as Paystack's popup covered the screen), so the
 * payer must come back to the same origin they left: that is where they are signed in,
 * and where the tab kept what the return page needs (lib/checkout-return.ts).
 *
 *  - a tenant's pages (a voucher sale, a plan payment or an addon): its own subdomain's
 *    /payment-return/<purpose>/<reference> (app/[tenantSlug]/payment-return);
 *  - a signup: the platform's /onboarding/paid/<reference>, which hands the payment to
 *    the signup.
 *
 * What the page needs is in the path, never the query: Monnify appends
 * `?paymentReference=…` to the address as given, even when it already has a `?`, which
 * would corrupt the last query value.
 */
export function tenantPaymentReturnUrl(tenantSlug: string, reference: string, purpose: "voucher" | "billing"): string {
  return absolute(tenantUrl(tenantSlug, `/payment-return/${purpose}/${encodeURIComponent(reference)}`));
}

export function signupPaymentReturnUrl(reference: string): string {
  return absolute(`/onboarding/paid/${encodeURIComponent(reference)}`);
}

/** Monnify needs an absolute address; without subdomains, tenant pages are paths. */
function absolute(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return `${base}${url}`;
}

/** Asks Knomad Pay how a charge stands (it asks Monnify first unless it is final). */
export async function verifyKnomadPayCharge(reference: string): Promise<VerifiedCharge> {
  try {
    const result = await knomadPay().getCharge(reference);
    if (!result.ok) {
      return { success: false, error: `Knomad Pay: ${result.code} ${result.message}`, standing: UNKNOWN_STANDING };
    }
    return toVerifiedCharge(result.data);
  } catch (error) {
    return { success: false, error: `Knomad Pay did not answer: ${(error as Error).message}`, standing: UNKNOWN_STANDING };
  }
}
