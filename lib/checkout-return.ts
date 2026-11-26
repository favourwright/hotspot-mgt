"use client";

/**
 * Leaving for Monnify's checkout, and coming back.
 *
 * Checkout is a full page, as Paystack's popup covered the screen before it: the dialog
 * sends the browser to Knomad Pay's `checkoutUrl`, and Monnify brings it back to the
 * return address the server gave the charge (lib/knomad-pay.ts) on the same origin. A
 * frame inside the dialog was tried and broke real card payments: banks' 3-D Secure and
 * OTP pages refuse to be framed, and browsers withhold a framed page's cookies.
 *
 * What the return page needs that the server does not keep (at the captive portal, how
 * the router logs this device in) is kept for this tab only, under the reference. The
 * server's own record decides the sale; this decides only what the page shows.
 */
import type { PortalSession } from "@/lib/captive-portal";

export type CheckoutReturn =
  /** A voucher sale: at the captive portal (with its session) or the storefront. */
  | { kind: "voucher"; portal: PortalSession | null }
  /** A plan period or an addon: back to that page once it is applied. */
  | { kind: "billing"; back: "settings" | "addons" }
  /** A signup's first month: onboarding finishes the signup with it. */
  | { kind: "signup" };

const key = (reference: string) => `checkout-return:${reference}`;

/** Remembers what the return page needs, then leaves for the checkout. */
export function leaveForCheckout(checkoutUrl: string, reference: string, ret: CheckoutReturn): void {
  try {
    window.sessionStorage.setItem(key(reference), JSON.stringify(ret));
  } catch {
    // Storage refused (private mode): the return page still finishes from the server's
    // record, and only loses the portal's automatic login.
  }
  window.location.assign(checkoutUrl);
}

/** What the payer left for checkout with, or null on another tab or device. */
export function checkoutReturnFor(reference: string): CheckoutReturn | null {
  try {
    const raw = window.sessionStorage.getItem(key(reference));
    return raw ? (JSON.parse(raw) as CheckoutReturn) : null;
  } catch {
    return null;
  }
}

/** Forgets it once the page has finished with it. */
export function forgetCheckoutReturn(reference: string): void {
  try {
    window.sessionStorage.removeItem(key(reference));
  } catch {
    // Nothing kept to forget.
  }
}
