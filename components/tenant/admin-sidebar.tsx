"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  MapPin,
  ServerCog,
  CreditCard,
  Ticket,
  AlertTriangle,
  Settings,
  LogOut,
  HelpCircle,
} from "lucide-react";

interface TenantAdminSidebarProps {
  tenantSlug: string;
  businessName: string;
}

export function TenantAdminSidebar({
  tenantSlug,
  businessName,
}: TenantAdminSidebarProps) {
  const pathname = usePathname();
  const { logout } = useAuth();

  const base = `/${tenantSlug}/admin`;

  const navItems = [
    {
      label: "Dashboard",
      href: base,
      icon: LayoutDashboard,
      exact: true,
    },
    { label: "Routers", href: `${base}/routers`, icon: ServerCog },
    { label: "Locations", href: `${base}/locations`, icon: MapPin },
    { label: "Plans", href: `${base}/plans`, icon: CreditCard },
    { label: "Vouchers", href: `${base}/vouchers`, icon: Ticket },
    { label: "Failed Queue", href: `${base}/failed`, icon: AlertTriangle },
    { label: "Settings", href: `${base}/settings`, icon: Settings },
  ];

  const isActive = (href: string, exact = false) => {
    if (exact) return pathname === href;
    // startsWith alone would also match a sibling route sharing this one's
    // prefix (e.g. /admin/billing vs /admin/billing-plans) — require a full
    // path segment boundary.
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <aside className="w-64 border-r bg-background flex flex-col min-h-screen">
      {/* Header */}
      <div className="p-4 border-b">
        <p className="font-semibold truncate">{businessName}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">
          /{tenantSlug}
        </p>
      </div>

      {/* Navigation */}
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

      {/* Footer */}
      <div className="p-4 border-t space-y-1">
        <Link
          href="/faq"
          target="_blank"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent"
        >
          <HelpCircle className="h-4 w-4 shrink-0" />
          Help / FAQ
        </Link>
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
