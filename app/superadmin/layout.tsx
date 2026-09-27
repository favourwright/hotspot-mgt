"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";
import { SuperAdminSidebar } from "@/components/superadmin/sidebar";

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
    <div className="flex min-h-screen">
      <SuperAdminSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
