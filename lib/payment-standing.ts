/**
 * How a payment stands when it has not been turned into what it bought: what the
 * payment-return page (components/shared/payment-return.tsx) needs to say the right
 * thing. Shared by the voucher path (lib/voucher-fulfilment.ts) and the billing path
 * (lib/billing-charges.ts), and safe to import in the browser.
 *
 *  - `awaiting_payment`: no money yet, and the checkout is still open. Going back to it
 *    is the same charge, so it can never be paid twice. `checkoutUrl` is null when the
 *    caller is not known to be the one who started it.
 *  - `not_paid`: the checkout is closed without money (failed or expired). Trying again
 *    is a new charge.
 *  - `received`: money moved, and finishing it is in progress or with a person. The
 *    one thing the payer must not do is pay again.
 *  - `unknown`: it could not be checked (Knomad Pay did not answer), or the reference
 *    is not the caller's to ask about. Says nothing either way.
 */
import type { Charge } from "@favourwright/knomad-pay-client";

export type PaymentStanding =
  | { state: "awaiting_payment"; checkoutUrl: string | null }
  | { state: "not_paid"; reason: "failed" | "expired" }
  | { state: "received" }
  | { state: "unknown" };

export const UNKNOWN_STANDING: PaymentStanding = { state: "unknown" };

/** A Knomad Pay charge that is not `succeeded`, in this app's terms. */
export function standingOfCharge(status: Charge["status"], checkoutUrl: string | null): PaymentStanding {
  switch (status) {
    case "initiating":
    case "pending":
      return { state: "awaiting_payment", checkoutUrl };
    case "failed":
    case "expired":
      return { state: "not_paid", reason: status };
    case "partially_paid":
    case "needs_review":
    case "succeeded":
      return { state: "received" };
  }
}

/** Whether asking again a moment later could change the answer. */
export function worthAskingAgain(standing: PaymentStanding): boolean {
  return standing.state === "awaiting_payment" || standing.state === "unknown";
}
