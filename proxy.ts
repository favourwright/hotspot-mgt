import { NextRequest, NextResponse } from "next/server";

/**
 * Hosts that are the platform itself rather than a tenant, mapped to the
 * path they serve. Every key must also be in `RESERVED_SLUGS`
 * (types/schemas.ts), or a tenant could register the slug and be shadowed
 * by this table.
 */
const PLATFORM_HOSTS: Record<string, string> = {
  superadmin: "/superadmin",
};

/**
 * Paths that exist only at the root of the app and are never tenant-scoped,
 * so they must not be rewritten under a slug.
 *
 * `/api` matters most -- `starlink.ogawifi.online/api/...` has to reach the
 * same route handler as the apex. But the platform *pages* matter just as
 * much: an unauthenticated visit to `{slug}.ogawifi.online/admin` redirects
 * to `/auth`, and rewriting that to `/{slug}/auth` 404s the sign-in page a
 * tenant owner was just sent to.
 */
const HOST_NEUTRAL_PREFIXES = [
  "/api",
  "/_next",
  "/favicon.ico",
  "/auth",
  "/onboarding",
  "/faq",
  "/superadmin",
];

/**
 * The apex this app is served from, derived from the public app URL so
 * there's one value to keep in sync rather than two.
 */
function rootDomain(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    const { hostname } = new URL(raw);
    // An IP address has no subdomains to speak of.
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ? null : hostname;
  } catch {
    return null;
  }
}

/**
 * The single label in front of the root domain, or `null` when the request
 * is for the apex, `www`, an IP, localhost, or anything else we don't own.
 *
 * Deliberately only matches one level: `a.b.ogawifi.online` returns null
 * rather than guessing, so an unexpected host falls through to the normal
 * path-based routing instead of being rewritten somewhere surprising.
 */
function subdomainOf(host: string | null, root: string): string | null {
  if (!host) return null;

  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === root || hostname === `www.${root}`) return null;
  if (!hostname.endsWith(`.${root}`)) return null;

  const label = hostname.slice(0, -(root.length + 1));
  return label && !label.includes(".") ? label : null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (HOST_NEUTRAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const root = rootDomain();
  if (!root) return NextResponse.next();

  const subdomain = subdomainOf(request.headers.get("host"), root);
  if (!subdomain) return NextResponse.next();

  const platformPath = PLATFORM_HOSTS[subdomain];

  // `superadmin.ogawifi.online/tenants` -> `/superadmin/tenants`, and the
  // bare host -> `/superadmin`.
  if (platformPath) {
    return rewriteTo(request, `${platformPath}${pathname === "/" ? "" : pathname}`);
  }

  // Already slug-prefixed: `starlink.ogawifi.online/starlink/admin` is what
  // a path-style link produces once it's followed on the subdomain, and
  // prefixing again would give `/starlink/starlink/admin`.
  if (pathname === `/${subdomain}` || pathname.startsWith(`/${subdomain}/`)) {
    return NextResponse.next();
  }

  // `starlink.ogawifi.online/admin` -> `/starlink/admin`. A tenant that
  // doesn't exist still resolves here, and the `[tenantSlug]` layout answers
  // with the 404 it already has.
  const target = `/${subdomain}${pathname === "/" ? "" : pathname}`;

  return rewriteTo(request, target);
}

function rewriteTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
