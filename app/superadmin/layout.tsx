"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { SuperAdminNav } from "@/components/superadmin/platform-nav";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";

export default function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userRole, loading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/auth?redirect=/superadmin");
        return;
      }
      if (userRole !== "superadmin") {
        router.replace("/");
        return;
      }
    }
  }, [user, userRole, loading, router]);

  if (loading) return null;
  if (userRole !== "superadmin") return null;

  return (
    <AppShell>
      <SuperAdminNav />
      <PageContent>{children}</PageContent>
    </AppShell>
  );
}
