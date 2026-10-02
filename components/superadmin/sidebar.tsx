"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Building2,
  Settings,
  CreditCard,
  Tags,
  LogOut,
  Shield,
} from "lucide-react";

export function SuperAdminSidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  const navItems = [
    {
      label: "Overview",
      href: "/superadmin",
      icon: LayoutDashboard,
      exact: true,
    },
    {
      label: "Tenants",
      href: "/superadmin/tenants",
      icon: Building2,
    },
    {
      label: "Billing",
      href: "/superadmin/billing",
      icon: CreditCard,
    },
    {
      label: "Billing Plans",
      href: "/superadmin/billing-plans",
      icon: Tags,
    },
    {
      label: "Platform Config",
      href: "/superadmin/config",
      icon: Settings,
    },
  ];

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 border-r bg-background flex flex-col min-h-screen">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold text-sm">Super Admin</p>
            <p className="text-xs text-muted-foreground">
              Platform Management
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 px-3 py-2",
              "rounded-md text-sm transition-colors",
              isActive(item.href, item.exact)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t">
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground"
          onClick={logout}
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </aside>
  );
}
