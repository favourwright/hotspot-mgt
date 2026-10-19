/**
 * The tenant's support number, which is the one phone number this app
 * publishes to strangers.
 *
 * Owners type a Nigerian mobile number four different ways - `0803...`,
 * `803...`, `234803...`, `+234 803 123 4567` - and all four mean the same
 * thing. Normalising on save rather than at render means the stored value
 * has exactly one shape, so every consumer (the `tel:` link, the WhatsApp
 * deep link, the settings form) can assume it rather than each re-deriving
 * it from whatever was typed.
 */

/** Nigeria. The only country this platform sells in. */
const COUNTRY_CODE = "234";

/**
 * The national significant number: 10 digits, starting 7, 8 or 9.
 *
 * Deliberately strict, and deliberately mobile-only. A landline written in
 * its own shorter form is rejected, which is the right trade here: the
 * number is published on a page customers tap to call, WhatsApp needs a
 * mobile anyway, and the failure this guards against is an owner typing
 * nine digits and nobody noticing until a customer cannot reach them.
 */
const NSN = /^[789]\d{9}$/;

/**
 * Any of the forms an owner might type, as `+234XXXXXXXXXX`, or null if it
 * is not a Nigerian mobile number. Spaces, dashes, dots and parentheses are
 * stripped first - they are how people write a number, not part of it.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(digits)) return null;

  // Longest prefix first: `234` is a prefix of nothing else here, but a
  // leading `0` has to be tested after it or `0234...` would survive.
  let nsn = digits;
  if (nsn.startsWith(COUNTRY_CODE)) nsn = nsn.slice(COUNTRY_CODE.length);
  else if (nsn.startsWith("0")) nsn = nsn.slice(1);

  return NSN.test(nsn) ? `+${COUNTRY_CODE}${nsn}` : null;
}

/**
 * The local part of a stored number, grouped for reading: `803 123 4567`.
 *
 * Used beside the fixed `+234` addon in the settings form and on the portal,
 * where the country code is already said once and repeating it in the value
 * reads as a mistake.
 */
export function formatLocalPhone(e164: string): string {
  const nsn = e164.replace(`+${COUNTRY_CODE}`, "");
  if (!NSN.test(nsn)) return e164;
  return `${nsn.slice(0, 3)} ${nsn.slice(3, 6)} ${nsn.slice(6)}`;
}

/**
 * Bare digits with the country code and no `+`, which is what WhatsApp's
 * `phone` parameter wants.
 */
export function whatsappDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}

/**
 * A WhatsApp deep link, as the `whatsapp://` scheme rather than `wa.me`.
 *
 * **This is a walled-garden decision, not a style one.** `wa.me` is an
 * HTTPS host, and the portal's audience has not paid for internet yet - it
 * is not in the walled garden every install writes, so tapping a `wa.me`
 * link from the portal does nothing at all. The scheme opens the installed
 * app with no network whatsoever.
 *
 * The message still cannot *send* until the customer has data, by finishing
 * the purchase or switching to mobile. Fixing that means allowing WhatsApp's
 * own servers through the walled garden, which hands every unauthenticated
 * client on the network free messaging and calls - the tenant's decision to
 * make, not a default to ship. The `tel:` link is the channel that always
 * works, which is why the portal leads with it.
 */
export function whatsappHref(e164: string, message: string): string {
  const params = new URLSearchParams({
    phone: whatsappDigits(e164),
    text: message,
  });
  return `whatsapp://send?${params.toString()}`;
}

/** The dialler. Works on the cellular radio, so it needs no internet. */
export function telHref(e164: string): string {
  return `tel:${e164}`;
}
