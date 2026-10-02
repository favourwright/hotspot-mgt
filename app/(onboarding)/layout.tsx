"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userRole, tenantId, loading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  // This layout wraps BOTH the wizard (/onboarding) and its own destination
  // (/onboarding/complete). "owner with a tenantId" is the correct, terminal
  // state to land on /onboarding/complete in — it must never redirect away
  // from or hide that one page, only the wizard itself.
  const isCompletePage = pathname === "/onboarding/complete";

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/auth?redirect=/onboarding");
        return;
      }
      if (userRole === "owner" && tenantId && !isCompletePage) {
        router.replace("/onboarding/complete");
        return;
      }
      if (userRole === "superadmin") {
        router.replace("/superadmin");
        return;
      }
    }
  }, [user, userRole, tenantId, loading, router, isCompletePage]);

  // Mirror the redirect conditions above exactly — render nothing until
  // we're sure none of them apply, so onboarding content never flashes for
  // a user about to be redirected away from it.
  if (loading) return null;
  if (!user) return null;
  if (userRole === "owner" && tenantId && !isCompletePage) return null;
  if (userRole === "superadmin") return null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}
