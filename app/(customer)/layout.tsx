"use client";

import { useAuth } from "@/providers/auth-provider";
import { CreditCard, Home, Ticket } from "lucide-react";
import { AppSidebar } from "@/components/shared/app-sidebar";
import { SiteHeader } from "@/components/shared/site-header";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";

export default function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();

  const navItems = [
    { href: "/", label: "Buy Plans", icon: Home },
    ...(user ? [{ href: "/my-vouchers", label: "My Vouchers", icon: Ticket }] : []),
  ];

  return (
    <SidebarProvider>
      <AppSidebar navItems={navItems} title="Hotspot Portal" />
      <SidebarInset>
        <SiteHeader title="Customer Portal" />
        <div className="flex flex-1 flex-col gap-4 p-4">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
