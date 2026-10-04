import { NextRequest } from "next/server";

import { getTenant } from "@/lib/tenant-context";
import { buildPortalShim } from "@/lib/hotspot-portal";

/**
 * Serves the `login.html` shim a router installs for a tenant.
 *
 * Public and unauthenticated on purpose: the consumer is `/tool/fetch` on a
 * MikroTik, which can't carry a bearer token. Nothing sensitive is exposed
 * -- the response is a redirect stub built from the tenant's public slug,
 * and the slug is already in every portal URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const tenant = await getTenant(slug);
  if (!tenant) {
    return new Response("Unknown portal", { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return new Response("App URL not configured", { status: 500 });
  }

  // The tenant's own subdomain, so the portal arrives already branded and
  // the walled garden only has to allow one wildcard.
  const { protocol, host } = new URL(appUrl);
  const portalUrl = `${protocol}//${tenant.slug}.${host}/portal`;

  return new Response(buildPortalShim(portalUrl), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The router re-fetches this on every install; a stale cached copy
      // would silently pin a tenant to an old portal URL.
      "Cache-Control": "no-store",
    },
  });
}
