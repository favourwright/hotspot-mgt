/**
 * Turning RouterOS's login failures into something a customer can act on.
 *
 * MikroTik substitutes `$(error)` into `login.html` when an attempt fails,
 * and our shim forwards it here as a query param. Left alone it produces
 * things like "invalid username or password" and "no more sessions are
 * allowed for user HS-4KJ2P9XQ" - accurate, and useless to someone standing
 * in a shop wondering whether to buy another plan.
 *
 * ## Where the text comes from
 *
 * RouterOS reads every message from an `errors.txt` in the hotspot servlet
 * directory - which, since we install into a directory of our own, is a file
 * we control. So rather than pattern-matching English prose that varies by
 * RouterOS version and can be edited on the router, we install an errors.txt
 * that emits a **stable token** per cause, and map tokens here.
 *
 * Two things make that worth the extra file:
 *
 * 1. A token is exact. Matching "no more sessions are allowed for user X"
 *    means matching a sentence with a username in the middle of it.
 * 2. A token is URL-safe. The shim forwards `error=$(error)` and MikroTik
 *    offers no `-esc` variant for it, so a stock message containing `&` or
 *    `?` truncates the whole query string. Our tokens are `[a-z-]` only.
 *
 * `STOCK_PATTERNS` stays as the fallback, because a portal installed before
 * this existed has no errors.txt of ours until it is reinstalled, and because
 * a tenant may have their own file. Anything unrecognised falls through to a
 * generic message rather than showing the customer router jargon.
 */

/** Prefix on every token we emit, so ours are never confused with a router's. */
const TOKEN_PREFIX = "oga-";

export interface PortalErrorMessage {
  /** The headline. A statement of what happened, in the customer's terms. */
  title: string;
  /** What to do about it. Always actionable, never an apology. */
  body: string;
  /**
   * Whether buying is the way out of this. Drives whether the portal points
   * the customer at the plan list or tells them to wait - offering a plan to
   * someone whose network is full would just take their money.
   */
  offerPlans: boolean;
}

/**
 * Every error key RouterOS's errors.txt defines, with the copy we show.
 *
 * The keys are MikroTik's, not ours, and the file we generate below has to
 * define all of them: a key we leave out falls back to RouterOS's own
 * wording, which is the thing this module exists to replace.
 */
const ERRORS: Record<string, PortalErrorMessage> = {
  "invalid-username": {
    title: "That voucher didn't work",
    body: "Check the username and password - they are case-sensitive, and it is easy to mix up 0 and O. If you just bought this plan, copy the details from the email we sent you.",
    offerPlans: false,
  },
  "invalid-mac": {
    title: "This voucher belongs to another device",
    body: "It was first used on a different phone or laptop and stays tied to it. Sign in on that device, or buy a plan for this one.",
    offerPlans: true,
  },
  "wrong-mac-username": {
    title: "That voucher didn't work",
    body: "Those sign-in details are not valid on this device. Check them against your email, or buy a plan to get online now.",
    offerPlans: true,
  },
  "user-session-limit": {
    title: "That voucher is already in use",
    body: "It is signed in on another device. Disconnect there first, or buy a second plan to use both at once.",
    offerPlans: true,
  },
  "uptime-limit": {
    title: "Your plan has run out of time",
    body: "The time included in this voucher has been used up. Buy another plan to carry on.",
    offerPlans: true,
  },
  "traffic-limit": {
    title: "You have used all your data",
    body: "This voucher's data allowance is finished. Buy another plan to carry on.",
    offerPlans: true,
  },
  "license-session-limit": {
    title: "The network is full right now",
    body: "Too many people are connected here. Wait a few minutes and try again - you do not need to buy anything.",
    offerPlans: false,
  },
  "ippool-empty": {
    title: "The network is full right now",
    body: "There is no room for another device at the moment. Wait a few minutes and try again - you do not need to buy anything.",
    offerPlans: false,
  },
  "shutting-down": {
    title: "The Wi-Fi is restarting",
    body: "This network is going offline briefly. Try again in a few minutes.",
    offerPlans: false,
  },
  "not-logged-in": {
    title: "You are not signed in",
    body: "Enter your voucher details below to get online.",
    offerPlans: false,
  },
  "chap-missing": {
    title: "Your browser could not complete sign-in",
    body: "Reload this page and try again. If it keeps happening, open the Wi-Fi sign-in page from your phone's notification instead of from a bookmark.",
    offerPlans: false,
  },
  "radius-timeout": {
    title: "We could not check your voucher",
    body: "The sign-in service did not answer. Wait a moment and try again - your voucher has not been used up.",
    offerPlans: false,
  },
  "auth-in-progress": {
    title: "Already signing you in",
    body: "Give it a few seconds. If nothing happens, reload this page and try once more.",
    offerPlans: false,
  },
  "radius-reply": {
    title: "That voucher was refused",
    body: "Check the details and try again, or buy a plan to get online now.",
    offerPlans: true,
  },
  "internal-error": {
    title: "Something went wrong on the network",
    body: "This is a problem at our end, not with your voucher. Try again in a moment.",
    offerPlans: false,
  },
  "config-error": {
    title: "Something went wrong on the network",
    body: "This network is not set up correctly, so sign-in cannot complete. Please let the staff here know.",
    offerPlans: false,
  },
};

/**
 * Shown when the router sent something we do not recognise.
 *
 * Deliberately does not repeat the router's own words. They are the reason
 * this module exists, and a half-translated page that says "Sign-in failed"
 * and then "invalid chap-id" underneath is worse than one that says neither.
 */
const UNKNOWN: PortalErrorMessage = {
  title: "Sign-in didn't work",
  body: "Check your voucher details and try again. If you do not have a voucher yet, choose a plan below.",
  offerPlans: true,
};

/**
 * Stock RouterOS wording, for routers with no errors.txt of ours.
 *
 * Ordered, and matched as substrings on a lowercased message, because some of
 * these interpolate a username or an IP. Only the phrases that are stable
 * across versions are matched; anything else goes to UNKNOWN, which is the
 * safe direction - a wrong friendly message sends someone to buy a plan they
 * do not need.
 */
const STOCK_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/invalid username or password/, "invalid-username"],
  [/no more sessions are allowed/, "user-session-limit"],
  [/session limit reached/, "license-session-limit"],
  [/no more free addresses|address.*pool/, "ippool-empty"],
  [/shutting down/, "shutting-down"],
  [/not logged in/, "not-logged-in"],
  [/uptime limit/, "uptime-limit"],
  [/(transfer|traffic|transmit).*limit/, "traffic-limit"],
  [/radius.*(not respond|timeout)/, "radius-timeout"],
  [/already in progress|in progress/, "auth-in-progress"],
  [/chap/, "chap-missing"],
  [/mac address/, "invalid-mac"],
  [/internal error/, "internal-error"],
  [/config/, "config-error"],
];

/**
 * The customer-facing message for whatever the router said.
 *
 * Null for no error at all, so a caller can tell "nothing went wrong" from
 * "something went wrong and we do not know what" - the first renders nothing,
 * the second renders UNKNOWN.
 */
export function friendlyPortalError(
  raw: string | null | undefined
): PortalErrorMessage | null {
  const value = raw?.trim();
  if (!value) return null;

  // An unsubstituted placeholder is not an error. RouterOS leaves `$(error)`
  // verbatim when it has nothing to put there, and some firmwares send the
  // literal string through rather than an empty parameter.
  if (value.startsWith("$(")) return null;

  const lower = value.toLowerCase();

  if (lower.startsWith(TOKEN_PREFIX)) {
    return ERRORS[lower.slice(TOKEN_PREFIX.length)] ?? UNKNOWN;
  }

  for (const [pattern, key] of STOCK_PATTERNS) {
    if (pattern.test(lower)) return ERRORS[key] ?? UNKNOWN;
  }

  return UNKNOWN;
}

/** The file RouterOS reads its messages from. Lives in our own directory. */
export const ERRORS_FILE = "errors.txt";

/**
 * Our errors.txt: every key mapped to a token instead of a sentence.
 *
 * The format is RouterOS's: `key = value`, one per line, `#` for comments.
 * No `$(...)` interpolation anywhere on purpose - the value travels through a
 * query string with no escaping available, so a username or an original error
 * message in here could carry characters that truncate it.
 */
export function buildErrorsFile(): string {
  const lines = [
    "# Installed by Oga WiFi. Do not edit - reinstalling the portal overwrites it.",
    "#",
    "# Each message is a stable token rather than English prose. The portal",
    "# maps them to customer-facing text (lib/hotspot-errors.ts), which it can",
    "# only do reliably if what arrives is exact and URL-safe. Editing a value",
    "# here does not change what the customer reads; it just stops us",
    "# recognising the error and falls back to a generic message.",
    "",
  ];

  for (const key of Object.keys(ERRORS)) {
    lines.push(`${key} = ${TOKEN_PREFIX}${key}`);
  }

  return lines.join("\n") + "\n";
}
