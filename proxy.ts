import { NextRequest, NextResponse } from "next/server";

import { appRootDomain, PLATFORM_HOSTS } from "@/lib/app-host";

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
  "/developers",
  "/privacy",
  "/acceptable-use",
  "/superadmin",
];

/**
 * What the request's host means to us.
 *
 * `apex` covers the bare domain and `www`, where tenant pages are still
 * reachable by path but are no longer canonical. A single label in front of
 * the root domain is a `subdomain`. Anything else -- an IP, localhost, a
 * host we don't own, a deeper `a.b.ogawifi.online` -- is `foreign`, and
 * falls through to plain path-based routing rather than being guessed at.
 */
type HostKind =
  | { kind: "apex" }
  | { kind: "subdomain"; label: string }
  | { kind: "foreign" };

function classifyHost(host: string | null, root: string): HostKind {
  if (!host) return { kind: "foreign" };

  const hostname = host.split(":")[0].toLowerCase();
  if (hostname === root || hostname === `www.${root}`) return { kind: "apex" };
  if (!hostname.endsWith(`.${root}`)) return { kind: "foreign" };

  const label = hostname.slice(0, -(root.length + 1));
  return label && !label.includes(".")
    ? { kind: "subdomain", label }
    : { kind: "foreign" };
}

/**
 * The first path segment, which for a tenant-scoped URL is its slug.
 */
function firstSegment(pathname: string): string | null {
  const segment = pathname.split("/")[1];
  return segment ? segment.toLowerCase() : null;
}

/** The shape of SlugSchema, kept minimal: proxy.ts runs on every request. */
const SLUG_SHAPE = /^[a-z0-9-]{1,63}$/;

function redirectTo(request: NextRequest, host: string, pathname: string) {
  const url = request.nextUrl.clone();
  url.host = host;
  url.port = "";
  url.protocol = "https:";
  url.pathname = pathname || "/";
  // 308 rather than 307: this is permanent, and it keeps the method, which
  // matters for anything that POSTs to a path-style URL.
  return NextResponse.redirect(url, 308);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Nothing here uses next/image, so the optimizer is only attack surface: it
  // runs an image library over whatever it is pointed at, and that is where two
  // of Next's critical advisories have been. Refused here rather than in nginx
  // so it travels with the build and shows up in a diff. The matcher below has
  // to keep including this path for the check to run.
  if (pathname.startsWith("/_next/image")) {
    return new NextResponse(null, { status: 404 });
  }

  if (HOST_NEUTRAL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const root = appRootDomain();
  if (!root) return NextResponse.next();

  const host = classifyHost(request.headers.get("host"), root);

  // `ogawifi.online/starlink/admin` -> `starlink.ogawifi.online/admin`.
  //
  // The subdomain is the canonical home of a tenant's pages, and this is
  // what makes that true rather than merely preferred. It matters beyond
  // tidiness: with both forms live, link generation would have to know which
  // host it was rendering on, because `/admin/plans` means a tenant page on
  // one and nothing on the other. One canonical host per tenant reduces that
  // to a single build-time decision (see lib/tenant-url.ts).
  //
  // Old bookmarks and anything already printed keep working -- they redirect.
  if (host.kind === "apex" && pathname !== "/") {
    const slug = firstSegment(pathname);
    // Only something that could be a slug becomes a hostname. Anything else
    // (`/x@evil.com/a`, `/.env`) is left for the router to 404: the URL host
    // setter silently ignores an invalid host, which would otherwise redirect
    // to whatever host the request object already held.
    if (slug && SLUG_SHAPE.test(slug) && !PLATFORM_HOSTS[slug]) {
      return redirectTo(
        request,
        `${slug}.${root}`,
        pathname.slice(slug.length + 1)
      );
    }
  }

  if (host.kind !== "subdomain") return NextResponse.next();

  const { label } = host;
  const platformPath = PLATFORM_HOSTS[label];

  // `superadmin.ogawifi.online/tenants` -> `/superadmin/tenants`, and the
  // bare host -> `/superadmin`.
  if (platformPath) {
    return rewriteTo(request, `${platformPath}${pathname === "/" ? "" : pathname}`);
  }

  // `starlink.ogawifi.online/starlink/admin` -> `starlink.ogawifi.online/admin`.
  // That form is what a path-style link produces once it's followed on the
  // subdomain. Redirecting rather than quietly serving it keeps one URL per
  // page; serving both is what let the duplicate go unnoticed before.
  if (pathname === `/${label}` || pathname.startsWith(`/${label}/`)) {
    return redirectTo(request, `${label}.${root}`, pathname.slice(label.length + 1));
  }

  // `starlink.ogawifi.online/admin` -> `/starlink/admin`. A tenant that
  // doesn't exist still resolves here, and the `[tenantSlug]` layout answers
  // with the 404 it already has.
  const target = `/${label}${pathname === "/" ? "" : pathname}`;

  return rewriteTo(request, target);
}

function rewriteTo(request: NextRequest, pathname: string) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
