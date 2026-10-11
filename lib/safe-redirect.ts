/**
 * Validating a `?next=` destination before sending anyone to it.
 *
 * The captive portal needs this: a visitor who has to sign in before buying
 * must come back to the portal with the session the router gave them intact
 * (`mac`, `link-login-only`, `link-orig`), and the only way to carry that
 * through `/auth` is in a query parameter.
 *
 * A query parameter is attacker-controlled, so an unvalidated one is an open
 * redirect: a link to our own sign-in page that lands on somebody else's
 * site, after the victim has just typed their password. Phishing gets to
 * borrow our domain's credibility for the first hop.
 *
 * Only two shapes are accepted:
 *
 *  - a root-relative path (`/portal?mac=...`), which cannot leave the origin;
 *  - an absolute URL whose host is the app's own root domain or one of its
 *    subdomains, which is what a tenant portal is.
 *
 * Everything else, including protocol-relative `//evil.com` (a URL the
 * browser reads as absolute but a naive "starts with /" check waves through),
 * returns null and the caller falls back to its normal destination.
 */

/** Parsed once: this is read on every sign-in. */
function rootDomain(): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return null;
  try {
    return new URL(appUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isOurHost(hostname: string): boolean {
  const root = rootDomain();
  if (!root) return false;
  const host = hostname.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

/**
 * The destination to use, or null when the caller should use its own default.
 *
 * `base` is only needed to resolve a relative path, and defaults to the
 * current origin in the browser.
 */
export function safeRedirect(
  next: string | null | undefined,
  base?: string
): string | null {
  if (!next) return null;

  const value = next.trim();
  if (!value) return null;

  // `//evil.com` and `/\evil.com` are absolute to a browser despite the
  // leading slash, so the relative case has to exclude them explicitly
  // rather than trust the first character.
  if (value.startsWith("/") && !/^\/[/\\]/.test(value)) {
    return value;
  }

  const origin =
    base ?? (typeof window !== "undefined" ? window.location.origin : undefined);

  try {
    const url = new URL(value, origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isOurHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Build the sign-in URL that will come back here afterwards. */
export function authUrlWithNext(currentUrl: string): string {
  return `/auth?next=${encodeURIComponent(currentUrl)}`;
}
