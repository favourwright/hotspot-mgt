"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";

interface AuthGuardProps {
  children: React.ReactNode;
  requiredRole: "customer" | "admin";
}

export function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const { user, userRole, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        // Not authenticated, redirect to auth
        router.push("/auth");
      } else if (userRole && userRole !== requiredRole) {
        // Wrong role, redirect to appropriate page
        router.push(userRole === "admin" ? "/admin" : "/");
      }
    }
  }, [user, userRole, loading, requiredRole, router]);

  // Show loading state
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
      </div>
    );
  }

  // Show nothing while redirecting
  if (!user || (userRole && userRole !== requiredRole)) {
    return null;
  }

  // Authorized, render children
  return <>{children}</>;
}
