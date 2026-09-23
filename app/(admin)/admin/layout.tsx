"use client";

import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { LayoutDashboard, MapPin, Package, Ticket, XCircle } from "lucide-react";
import { useEffect } from "react";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { SiteHeader } from "@/components/shared/site-header";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { PageLoader } from "@/components/shared/page-loader";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userRole, loading } = useAuth();
  const router = useRouter();

  const navItems = [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    { href: "/admin/locations", label: "Locations", icon: MapPin },
    { href: "/admin/plans", label: "Plans", icon: Package },
    { href: "/admin/vouchers", label: "Vouchers", icon: Ticket },
    { href: "/admin/failed", label: "Failed Queue", icon: XCircle },
  ];

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login?redirect=/admin");
    }
  }, [loading, user, router]);

  // Show loading while checking auth
  if (loading) {
    return (
      <PageLoader />
    );
  }

  // Return null while redirecting
  if (!user) {
    return null;
  }

  // Show access denied if not admin
  if (userRole !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
          <p className="text-muted-foreground mb-4">You do not have admin privileges</p>
          <p className="text-sm text-muted-foreground">Current role: {userRole || "none"}</p>
          <Button onClick={() => router.push("/")} className="mt-4">
            Go to Home
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar navItems={navItems} title="Joels Hub" />
      <SidebarInset>
        <SiteHeader title="Admin" />
        <div className="flex flex-1 flex-col gap-4 p-4">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
