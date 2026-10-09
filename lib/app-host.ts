/**
 * Where this deployment lives, derived from `NEXT_PUBLIC_APP_URL`.
 *
 * One function rather than three copies of the same parsing: the root domain
 * decides subdomain routing (`proxy.ts`), the session cookie's `Domain`
 * (`lib/server-auth.ts`), how tenant links are generated
 * (`lib/tenant-url.ts`) and the routers' walled garden
 * (`lib/hotspot-portal.ts`). Those must agree or the failures are subtle:
 * a cookie that doesn't reach a subdomain, a link to a host with no
 * certificate, a portal clients are blocked from loading.
 *
 * Returns `null` for an IP or localhost, which is the signal for
 * "no subdomains here" -- local development and the legacy
 * `193.123.183.184:8080` entry point both fall back to path-based routing.
 */
export function appRootDomain(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;

  try {
    const { hostname } = new URL(raw);
    if (hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

/** Whether tenants are served from `{slug}.{root}` rather than `/{slug}`. */
export function usesTenantSubdomains(): boolean {
  return appRootDomain() !== null;
}

/**
 * Hosts that are the platform itself rather than a tenant, mapped to the
 * path they serve. Every key must also be in `RESERVED_SLUGS`
 * (types/schemas.ts), or a tenant could register the slug and be shadowed.
 */
export const PLATFORM_HOSTS: Record<string, string> = {
  superadmin: "/superadmin",
};

/**
 * The tenant a hostname names, or `null` for the apex, a platform host, an
 * IP, localhost, or anything else we don't own.
 *
 * Deliberately only matches one label: `a.b.ogawifi.online` returns null
 * rather than guessing.
 */
export function tenantSlugFromHost(host: string | null): string | null {
  const root = appRootDomain();
  if (!root || !host) return null;

  const hostname = host.split(":")[0].toLowerCase();
  if (!hostname.endsWith(`.${root}`)) return null;

  const label = hostname.slice(0, -(root.length + 1));
  if (!label || label.includes(".") || label === "www") return null;

  return PLATFORM_HOSTS[label] ? null : label;
}
