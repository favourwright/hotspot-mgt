"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { TenantAdminNav } from "@/components/tenant/admin-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { pushTenantUrl, tenantHref } from "@/lib/tenant-url";

interface AdminShellProps {
  children: React.ReactNode;
  tenantSlug: string;
  /**
   * The notice region, rendered on the server by `AdminNotices` and passed
   * in rather than fetched here.
   *
   * This component is the access guard: it returns null until it is certain
   * the viewer belongs, so notices must not render themselves. Passing them
   * as a prop puts them inside that guard while leaving them server-side -
   * which is what lets the plan-fee notice, which needs firebase-admin,
   * appear on every admin route instead of only the dashboard.
   */
  notices?: React.ReactNode;
  /** Whether the tenant has a router and a location; picks the nav's main items. */
  setupComplete: boolean;
}

/**
 * The chrome and the access guard for every `/[tenantSlug]/admin` route.
 *
 * Was the layout itself until the notice region needed server data. The
 * layout is now a thin server component that renders this with the notices
 * already resolved; everything below is unchanged from when it was the
 * layout, because the redirect conditions were never the problem.
 */
export function AdminShell({ children, tenantSlug, notices, setupComplete }: AdminShellProps) {
  const { user, userRole, tenant, loading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace(
          `/auth?redirect=${encodeURIComponent(tenantHref(tenantSlug, "/admin"))}`
        );
        return;
      }

      if (userRole === "superadmin") {
        return;
      }

      if (userRole !== "owner") {
        router.replace(tenantHref(tenantSlug));
        return;
      }

      if (tenant?.slug && tenant.slug !== tenantSlug) {
        // A different tenant means a different host once subdomains are in
        // play, so this cannot stay on the client router.
        pushTenantUrl(router, tenant.slug, "/admin");
        return;
      }
    }
  }, [user, userRole, tenant, loading, router, tenantSlug]);

  // Mirror the redirect conditions above exactly - render nothing until
  // we're sure none of them apply, so unauthorized/mismatched content is
  // never painted even for the one tick before the effect's redirect fires.
  if (loading) return null;
  if (!user) return null;
  if (userRole !== "owner" && userRole !== "superadmin") return null;
  if (userRole === "owner" && tenant?.slug && tenant.slug !== tenantSlug) return null;

  return (
    <AppShell>
      <TenantAdminNav
        tenantSlug={tenantSlug}
        businessName={tenant?.businessName || ""}
        setupComplete={setupComplete}
      />
      <PageContent>
        {/*
          Owners only, decided server-side in AdminNotices. A superadmin
          viewing someone else's tenant would otherwise be nagged about their
          own address, and chased for a fee that is not theirs, on a page
          that has nothing to do with either.
        */}
        {notices}
        {children}
      </PageContent>
    </AppShell>
  );
}
