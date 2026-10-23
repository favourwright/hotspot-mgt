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
  // Held back until 2026-10-23, when the Cloudflare DNS token was replaced
  // and `certbot renew --dry-run` passed end to end, including the nginx
  // reload hook. Before that, renewal was broken and HSTS would have turned
  // the certificate expiry into "unreachable for everyone who has visited"
  // rather than "a warning the visitor can click through".
  //
  // `includeSubDomains` is required, not optional: every tenant is served on
  // {slug}.ogawifi.online and a policy set on the apex alone would leave all
  // of them downgradeable.
  //
  // max-age is deliberately one day, not a year. The dry run proves the
  // challenge works; it does not prove an unattended renewal does. Raise it
  // to 31536000 once the real renewal lands in early December. `preload` is
  // NOT set and must not be added casually - removal from the browser
  // preload list takes months and is not something we can undo ourselves.
  //
  // Note: HSTS applies to a hostname on every port, so a browser that has
  // visited the app will refuse http://ogawifi.online:8081 (globlinksadmin)
  // and :8082 (el-links). Both are reached by IP, which HSTS never covers.
  { key: "Strict-Transport-Security", value: "max-age=86400; includeSubDomains" },
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
