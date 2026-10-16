/**
 * Customer-chosen voucher credentials.
 *
 * A customer can pick the username and password they will type into the
 * hotspot login page, so a returning buyer always knows their own code
 * instead of reading a fresh random string off an email every time. That is
 * the whole point, and it is also where the danger is.
 *
 * ## Why the customer does not own the router username
 *
 * RouterOS hotspot users live in one flat namespace per router, and the
 * hotspot login page has no rate limiting, no lockout and no second factor.
 * If customers owned raw names, three things follow and all of them are bad:
 *
 *  - A "is this name available?" check is an enumeration oracle, and the
 *    answer "taken" names a real customer of this location.
 *  - A guessable name plus a weak password is free wifi on somebody else's
 *    allowance, burning their data cap and their `shared-users` slots.
 *  - Two customers of the same location genuinely collide, and one of them
 *    has to be told no for a reason that exposes the other.
 *
 * So the customer picks a **handle** and the router username is
 * `<handle>-<suffix>`, where the suffix is four characters generated once
 * per customer and never changed. Every handle is always available, there is
 * nothing to enumerate, and the customer still only has to remember one
 * string because the suffix is stable and shown to them. `nkechi-7k2p` is
 * learned once and is theirs forever.
 *
 * ## Why the pair is stored per tenant, not on the user account
 *
 * A tenant's owner can already read their own vouchers' passwords in the
 * admin UI, which is correct - they are wifi codes on a router that owner
 * controls. A single account-wide password would mean tenant A's owner
 * reading the credential that same person uses at tenant B. So the handle
 * and password live on `tenants/{tenantId}/customers/{uid}`, one pair per
 * (customer, tenant). The namespaces are per-router anyway, so this also
 * happens to be the shape the router imposes.
 *
 * Nothing here talks to Firestore or the router: it is pure validation and
 * formatting, which is what makes `npm run test:voucher-credentials` able to
 * cover the rules that matter.
 */

import { randomBytes } from "crypto";

/** Shortest handle worth having. Below this, collisions stop being the only problem. */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 20;

/**
 * Six, not eight.
 *
 * This is typed on a phone keyboard, on a captive portal, often by someone
 * standing up, and it guards a wifi session rather than an account. Eight
 * pushes people straight back to writing it on the receipt. The rules below
 * do more for real safety here than two extra characters would: the suffix
 * means the username cannot be guessed in the first place, and refusing
 * username-as-password removes the single most common failure.
 */
export const VOUCHER_PASSWORD_MIN_LENGTH = 6;
export const VOUCHER_PASSWORD_MAX_LENGTH = 32;

/** Length of the per-customer suffix appended to every handle. */
const SUFFIX_LENGTH = 4;

/**
 * No `0`/`o`, `1`/`l`/`i`. The suffix is read off a screen and typed into a
 * login box by someone who did not choose it, so the characters that get
 * mistaken for each other are simply not in the alphabet.
 */
const SUFFIX_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/**
 * A handle is lowercase alphanumeric with dots, hyphens and underscores
 * inside it, never at either end.
 *
 * The charset is this narrow because the value ends up in a RouterOS
 * username, in a REST path and in the hotspot login form. Quotes, spaces and
 * slashes all survive one of those layers and break another, and a leading
 * or trailing dot is the kind of thing nobody can see in the field they just
 * typed it into.
 */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

/** Same reasoning, one layer looser: a password is never put in a URL path. */
const PASSWORD_PATTERN = /^[A-Za-z0-9._@#$%*+-]+$/;

/**
 * Names the tenant, the router or RouterOS itself may already be using, plus
 * the ones an attacker tries first. The suffix makes a real collision
 * vanishingly unlikely, but `admin-7k2p` showing up in a hotspot user list
 * is still a thing nobody should be able to create.
 */
const RESERVED_HANDLES = [
  "admin",
  "administrator",
  "default",
  "default-trial",
  "free",
  "guest",
  "hotspot",
  "manager",
  "mikrotik",
  "operator",
  "owner",
  "root",
  "router",
  "staff",
  "superadmin",
  "support",
  "system",
  "test",
  "trial",
  "user",
  "wifi",
];

/**
 * Deliberately short. This is not a breach corpus - it is the handful of
 * strings that actually get typed into a wifi login box, and a long list
 * here would only slow down a check that runs on every keystroke in the
 * profile form.
 */
const COMMON_PASSWORDS = [
  "000000",
  "111111",
  "123123",
  "123456",
  "1234567",
  "12345678",
  "abc123",
  "admin123",
  "hotspot",
  "iloveyou",
  "internet",
  "letmein",
  "password",
  "password1",
  "qwerty",
  "welcome",
  "wifi1234",
];

export type CredentialCheck = { ok: true } | { ok: false; error: string };

const OK: CredentialCheck = { ok: true };

function reject(error: string): CredentialCheck {
  return { ok: false, error };
}

/**
 * Lowercases and trims, so "  nkechi " and "nkechi" are the same handle.
 *
 * Validation runs on the normalised form and the normalised form is what
 * gets stored, because a handle that differs from another only by case would
 * be two different RouterOS users and one very confused customer.
 */
export function normaliseHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateHandle(raw: string): CredentialCheck {
  const handle = normaliseHandle(raw);

  if (handle.length < HANDLE_MIN_LENGTH) {
    return reject(`Use at least ${HANDLE_MIN_LENGTH} characters`);
  }
  if (handle.length > HANDLE_MAX_LENGTH) {
    return reject(`Use at most ${HANDLE_MAX_LENGTH} characters`);
  }
  if (!HANDLE_PATTERN.test(handle)) {
    return reject(
      "Use lowercase letters, numbers, dots, hyphens and underscores, starting and ending with a letter or number"
    );
  }
  if (RESERVED_HANDLES.includes(handle)) {
    return reject("That name is reserved. Please pick another");
  }

  return OK;
}

/**
 * The password rules, in the order a person hits them.
 *
 * `handle` and `email` are passed in because the two rules that matter most
 * are both relational: a password that is the username, and a password that
 * is the email address with the domain cut off. Neither can be checked by
 * looking at the password on its own.
 */
export function validateVoucherPassword(
  raw: string,
  context: { handle?: string | null; email?: string | null } = {}
): CredentialCheck {
  // Checked before trimming, not after. A trailing space is accepted by
  // RouterOS, stored, emailed, and then silently dropped by the login form,
  // which leaves the customer certain they typed it right - so this is
  // refused rather than quietly fixed.
  if (raw !== raw.trim()) {
    return reject("Remove the spaces at the start or end");
  }

  const password = raw;

  if (password.length < VOUCHER_PASSWORD_MIN_LENGTH) {
    return reject(`Use at least ${VOUCHER_PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > VOUCHER_PASSWORD_MAX_LENGTH) {
    return reject(`Use at most ${VOUCHER_PASSWORD_MAX_LENGTH} characters`);
  }
  if (!PASSWORD_PATTERN.test(password)) {
    return reject(
      "Use letters, numbers, or any of . _ @ # $ % * + -"
    );
  }

  const lower = password.toLowerCase();

  if (COMMON_PASSWORDS.includes(lower)) {
    return reject("That password is too easy to guess");
  }

  const handle = context.handle ? normaliseHandle(context.handle) : null;
  if (handle) {
    // The rule this whole function exists for. People reuse the username as
    // the password constantly, and on a hotspot that turns a known username
    // into a free session. Containment both ways, because "nkechi1" is the
    // same mistake with a digit on the end.
    if (lower === handle) {
      return reject("Your password cannot be your username");
    }
    if (lower.includes(handle) || handle.includes(lower)) {
      return reject("Your password cannot contain your username");
    }
  }

  const localPart = context.email?.split("@")[0]?.trim().toLowerCase();
  if (localPart && localPart.length >= 3 && lower === localPart) {
    return reject("Your password cannot be your email address");
  }

  return OK;
}

/**
 * The four-character tail that makes a handle unique on the router.
 *
 * Generated once per (customer, tenant) and never rotated: the customer
 * learns it, and changing it would mean they no longer know their own
 * username, which is the only thing this feature is for.
 */
export function generateHandleSuffix(): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
  }
  return suffix;
}

/**
 * The name the router actually gets. Never store this on its own - it is
 * always derivable from the handle and the suffix, and a stored copy is one
 * more thing to keep in step when a customer changes their handle.
 */
export function routerUsernameFor(handle: string, suffix: string): string {
  return `${normaliseHandle(handle)}-${suffix}`;
}
