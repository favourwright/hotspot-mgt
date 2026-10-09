import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { appRootDomain } from "@/lib/app-host";

/**
 * Link generation for tenant pages, which live at `{slug}.ogawifi.online`
 * in production and at `/{slug}` everywhere else.
 *
 * There are two shapes, and picking the wrong one is the whole difficulty:
 *
 * - `tenantBasePath()` for a link *within* a tenant's own pages. On a
 *   subdomain that prefix is empty -- the host already says which tenant
 *   this is, so the link is just `/admin/plans` and stays a client-side
 *   navigation.
 * - `tenantUrl()` for a link that *crosses* hosts: superadmin opening a
 *   tenant's dashboard, or landing on one straight after onboarding. That
 *   has to be absolute, and the browser does a full page load.
 *
 * Both collapse to the old `/{slug}/...` form when there is no root domain,
 * so local development and the IP entry point are unaffected.
 *
 * This only works because the subdomain is canonical: `proxy.ts` redirects
 * the path form to it, so there is exactly one host per tenant and this
 * choice is a build-time one rather than something that has to know which
 * host rendered the page.
 */

/**
 * The prefix for an in-app link to a tenant page, given the tenant whose
 * pages we are already on. Empty string on a subdomain deployment.
 */
export function tenantBasePath(slug: string): string {
  return appRootDomain() ? "" : `/${slug}`;
}

/**
 * An in-app link to a tenant page, for use while already on that tenant's
 * host. Prefer this over composing `tenantBasePath()` by hand: the base is
 * an empty string on a subdomain, so a bare tenant root would otherwise come
 * out as `href=""`, which the browser resolves to the current URL.
 */
export function tenantHref(slug: string, path: string = "/"): string {
  const base = tenantBasePath(slug);
  if (path === "/") return base || "/";
  return `${base}${path}`;
}

/**
 * An absolute URL to a tenant page, for crossing from another host. Falls
 * back to a plain path when there are no subdomains to cross to.
 */
export function tenantUrl(slug: string, path: string = "/"): string {
  const root = appRootDomain();
  const suffix = path === "/" ? "" : path;

  if (!root) return `/${slug}${suffix}`;

  // https, unconditionally: a deployment with a root domain is the one that
  // has a certificate, and this is only ever used to leave the current host.
  return suffix ? `https://${slug}.${root}${suffix}` : `https://${slug}.${root}`;
}

/**
 * Imperative navigation to a tenant page, picking the right mechanism.
 *
 * A cross-origin URL cannot go through the Next router -- `router.push` to
 * another origin does not reliably do a full load -- so this reaches for
 * `window.location` when the target is absolute and leaves same-origin
 * navigation on the client router, where it stays fast.
 */
export function pushTenantUrl(
  router: AppRouterInstance,
  slug: string,
  path: string = "/"
): void {
  const url = tenantUrl(slug, path);

  if (url.startsWith("https://")) {
    window.location.assign(url);
    return;
  }

  router.push(url);
}
