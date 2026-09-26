"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userRole, tenantId, loading } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/auth?redirect=/onboarding");
        return;
      }
      if (userRole === "owner" && tenantId) {
        router.replace("/onboarding/complete");
        return;
      }
      if (userRole === "superadmin") {
        router.replace("/admin");
        return;
      }
    }
  }, [user, userRole, tenantId, loading, router]);

  if (loading) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}
