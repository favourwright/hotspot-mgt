import type { NextConfig } from "next"

/**
 * Response headers applied to every route.
 *
 * Set here rather than in nginx on purpose: `deploy/nginx-hotspot-mgt.conf`
 * is not the file the VPS actually runs any more, and a header that only
 * exists in a hand-edited server block is one nobody can review in a diff.
 * These travel with the build.
 *
 * Deliberately NOT here:
 *
 * - **`Content-Security-Policy`.** Paystack Inline injects script and an
 *   iframe at runtime, and the captive portal's pages are generated strings
 *   with inline handlers (lib/hotspot-portal.ts). A policy strict enough to
 *   be worth having would break checkout, which is the one flow that must
 *   never break. It needs its own pass with the portal in front of a real
 *   router, not a guess bolted onto a headers list.
 *
 * - **`Strict-Transport-Security`.** It is the right header for this app and
 *   it is held back for one specific reason: the wildcard certificate
 *   currently cannot renew and HTTPS breaks on 2027-01-02
 *   (`docs/open-items.md`). HSTS with `includeSubDomains` - which the
 *   per-tenant subdomains would need - removes the browser's ability to fall
 *   back to plain HTTP, turning that expiry from "the site warns" into "the
 *   site is unreachable for every visitor who has been here before", for the
 *   full max-age. Add it once renewal is fixed, not before.
 */
const securityHeaders = [
  // Stops a response being treated as a type it did not declare - the
  // sniffing that turns an uploaded file into executable script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nothing in this app is meant to be embedded. The router renders
  // alogin.html and status.html itself; it never frames us.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  // Tenant URLs carry the slug in the hostname and voucher pages carry ids,
  // so a full referer leaks who is looking at what to every outbound link.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // None of these are used anywhere in the app, including the portal.
  // `payment` is deliberately left alone: Paystack Inline is an iframe on
  // the one flow that must never break, and denying an API it may reach for
  // to close a surface nothing here uses is the wrong side of that trade.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
]

const nextConfig: NextConfig = {
  // Names the framework and its presence on every response, which is free
  // reconnaissance and buys nothing.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
