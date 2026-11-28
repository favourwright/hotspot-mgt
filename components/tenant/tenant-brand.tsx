"use client";

import { createContext, useContext } from "react";

/**
 * The tenant's logo for the app's own chrome: the top-left tile on the
 * customer pages and the admin dashboard.
 *
 * Resolved once, on the server, by `app/[tenantSlug]/layout.tsx` through
 * `getPortalBranding`, so the same plan check decides it as decides the
 * captive portal: a plan without custom branding gets null here and the
 * generated shape, exactly as the portal gets the default look. It is a
 * context rather than a prop because half a dozen client pages render the
 * nav and none of them otherwise need the tenant's branding.
 */
const TenantLogoContext = createContext<string | null>(null);

export function TenantBrandProvider({
  logo,
  children,
}: {
  logo: string | null;
  children: React.ReactNode;
}) {
  return <TenantLogoContext.Provider value={logo}>{children}</TenantLogoContext.Provider>;
}

/** The tenant's logo as a data URI, or null for the generated tile. */
export function useTenantLogo(): string | null {
  return useContext(TenantLogoContext);
}
