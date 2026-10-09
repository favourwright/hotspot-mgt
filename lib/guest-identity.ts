/**
 * Identity for a captive-portal buyer who has no account.
 *
 * Someone standing in a shop with no data cannot be asked to create an
 * account first -- the sign-up email they'd need to confirm is on the far
 * side of the paywall they're trying to get through. So a portal purchase
 * is keyed to the one identifier the router already gave us: the device's
 * MAC.
 *
 * This is deliberately NOT an authentication mechanism. A MAC is trivially
 * spoofable and arrives in a query string the client controls. It is only
 * ever a *label* on a payment that Paystack has already confirmed -- the
 * actual boundary is the server-side reference verification in
 * /api/payment/verify, which is the same for guests and signed-in users.
 */

export const GUEST_UID_PREFIX = "guest:";

/** `aa-bb-cc-dd-ee-ff` and `AA:BB:...` are the same device. */
export function normalizeMac(mac: string): string {
  return mac.trim().replace(/-/g, ":").toUpperCase();
}

/**
 * Stable across visits on purpose: the same device buying again at the same
 * tenant lands on the same customer record, so their voucher history and
 * the tenant's customer count both stay honest.
 */
export function guestUidForMac(mac: string): string {
  return `${GUEST_UID_PREFIX}${normalizeMac(mac)}`;
}

export function isGuestUid(uid: string): boolean {
  return uid.startsWith(GUEST_UID_PREFIX);
}
