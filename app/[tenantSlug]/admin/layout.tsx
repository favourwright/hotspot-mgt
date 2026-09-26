"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

interface TenantAdminLayoutProps {
  children: React.ReactNode;
  params: { tenantSlug: string };
}

export default function TenantAdminLayout({
  children,
  params,
}: TenantAdminLayoutProps) {
  const { user, userRole, tenant, loading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace(`/auth?redirect=/${params.tenantSlug}/admin`);
        return;
      }

      if (userRole === "superadmin") {
        // Superadmin can access any tenant admin
        return;
      }

      if (userRole !== "owner") {
        router.replace(`/${params.tenantSlug}`);
        return;
      }

      if (tenant?.slug !== params.tenantSlug) {
        // Owner trying to access another tenant's admin
        router.replace(`/${tenant?.slug}/admin`);
        return;
      }
    }
  }, [user, userRole, tenant, loading, router, params]);

  if (loading) return null;

  return <>{children}</>;
}
