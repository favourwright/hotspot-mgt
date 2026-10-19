/**
 * The captive-portal session, as handed to us by the router.
 *
 * MikroTik substitutes these into the `login.html` it serves, and our shim
 * forwards them here as query params. Everything is optional: a client can
 * land on this page without them (a bookmark, a QR code, our own dev
 * harness), and the page still has to render something sensible.
 */
export interface PortalSession {
  /** The client's MAC, as the router sees it. The key for server-side login. */
  mac: string | null;
  /** The client's IP on the hotspot network. */
  ip: string | null;
  /**
   * The router URL a login must be POSTed to. Without it there is nothing
   * to log in against, so the form can't be shown.
   */
  linkLoginOnly: string | null;
  /** Where the client was heading before being intercepted. */
  linkOrig: string | null;
  /** A failure message from a previous attempt, passed back by the router. */
  error: string | null;
}

const PARAM_KEYS = {
  mac: ["mac", "client-mac"],
  ip: ["ip", "client-ip"],
  linkLoginOnly: ["link-login-only", "linkLoginOnly"],
  linkOrig: ["link-orig", "linkOrig", "dst"],
  error: ["error"],
} as const;

type RawParams = Record<string, string | string[] | undefined>;

function read(params: RawParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) return first.trim();
  }
  return null;
}

/**
 * `link-login-only` decides whether a login is even possible, so it is the
 * one value we validate rather than trust: it arrives in a query string a
 * client controls, and it ends up as a form `action`. Only an
 * http(s) URL is accepted, which rules out `javascript:` and friends.
 */
function safeLoginUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function parsePortalSession(params: RawParams): PortalSession {
  return {
    mac: read(params, PARAM_KEYS.mac),
    ip: read(params, PARAM_KEYS.ip),
    linkLoginOnly: safeLoginUrl(read(params, PARAM_KEYS.linkLoginOnly)),
    linkOrig: read(params, PARAM_KEYS.linkOrig),
    error: read(params, PARAM_KEYS.error),
  };
}

/**
 * Stand-in values so the portal can be developed and reviewed without a
 * router in the loop. Only ever applied in development, and only when the
 * router gave us nothing -- a real session is never overwritten.
 */
export function withDevFallback(session: PortalSession): PortalSession {
  if (process.env.NODE_ENV !== "development") return session;
  if (session.linkLoginOnly) return session;

  return {
    mac: session.mac ?? "AA:BB:CC:DD:EE:FF",
    ip: session.ip ?? "10.5.50.14",
    linkLoginOnly: "http://10.5.50.1/login",
    linkOrig: session.linkOrig ?? "http://example.com",
    error: session.error,
  };
}

/**
 * The session, back as a query string, for links between the two portal
 * routes (`/{slug}/portal` and `/{slug}/portal/plans`).
 *
 * The router hands these values to the first page we render and to nothing
 * else, so any link that leaves that page has to carry them or the session
 * is gone: no `link-login-only` means no way to log the client in after
 * they pay, and no `mac` means the purchase is not stamped with a
 * `deviceMac` -- which is the condition `/api/payment/verify` uses to decide
 * whether to hand back voucher credentials at all. Both fail silently. The
 * customer pays, sees no error, and never gets online.
 *
 * Param names match what `buildPortalShim` emits so `parsePortalSession`
 * reads its own output back.
 *
 * `error` is deliberately dropped. It describes one failed sign-in attempt
 * on the page it was issued for; carrying it through a navigation would
 * re-raise a stale alert about a form the customer has since left.
 */
export function portalSessionQuery(session: PortalSession): string {
  const params = new URLSearchParams();

  if (session.mac) params.set("mac", session.mac);
  if (session.ip) params.set("ip", session.ip);
  if (session.linkLoginOnly)
    params.set("link-login-only", session.linkLoginOnly);
  if (session.linkOrig) params.set("link-orig", session.linkOrig);

  return params.toString();
}

/**
 * A portal path with the session appended, which is the only way these two
 * routes should ever link to each other.
 */
export function portalHref(path: string, session: PortalSession): string {
  const query = portalSessionQuery(session);
  return query ? `${path}?${query}` : path;
}
