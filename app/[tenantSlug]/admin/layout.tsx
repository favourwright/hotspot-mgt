"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

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
        router.replace(`/auth?redirect=/${tenantSlug}/admin`);
        return;
      }

      if (userRole === "superadmin") {
        return;
      }

      if (userRole !== "owner") {
        router.replace(`/${tenantSlug}`);
        return;
      }

      if (tenant?.slug && tenant.slug !== tenantSlug) {
        router.replace(`/${tenant.slug}/admin`);
        return;
      }
    }
  }, [user, userRole, tenant, loading, router, tenantSlug]);

  if (loading) return null;

  return <>{children}</>;
}
