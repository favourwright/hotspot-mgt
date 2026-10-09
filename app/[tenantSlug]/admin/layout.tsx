"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { TenantAdminNav } from "@/components/tenant/admin-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { pushTenantUrl, tenantHref } from "@/lib/tenant-url";

interface TenantAdminLayoutProps {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}

export default function TenantAdminLayout({
  children,
  params,
}: TenantAdminLayoutProps) {
  const { tenantSlug } = use(params);
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
      />
      <PageContent>{children}</PageContent>
    </AppShell>
  );
}
