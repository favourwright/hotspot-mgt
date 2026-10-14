"use client";

import {
  AlertTriangle,
  Blocks,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  MapPin,
  Receipt,
  ServerCog,
  Settings,
  Ticket,
  Users,
} from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { getAvatarUrl } from "@/lib/utils";
import { tenantBasePath } from "@/lib/tenant-url";

interface TenantAdminNavProps {
  tenantSlug: string;
  businessName: string;
}

export function TenantAdminNav({
  tenantSlug,
  businessName,
}: TenantAdminNavProps) {
  const { user, logout } = useAuth();
  // Empty on a subdomain deployment: the host already names the tenant.
  const base = `${tenantBasePath(tenantSlug)}/admin`;

  // The hot path. Routers earns a pill because it's core to running a
  // hotspot; Failed Queue doesn't, because the dashboard already surfaces it.
  const items: NavItem[] = [
    { label: "Dashboard", href: base, icon: LayoutDashboard, exact: true },
    { label: "Routers", href: `${base}/routers`, icon: ServerCog },
    { label: "Locations", href: `${base}/locations`, icon: MapPin },
    { label: "Plans", href: `${base}/plans`, icon: CreditCard },
    { label: "Vouchers", href: `${base}/vouchers`, icon: Ticket },
    { label: "Users", href: `${base}/users`, icon: Users },
  ];

  const overflow: NavItem[] = [
    { label: "Transactions", href: `${base}/transactions`, icon: Receipt },
    { label: "Addons", href: `${base}/addons`, icon: Blocks },
    { label: "Failed Queue", href: `${base}/failed`, icon: AlertTriangle },
    { label: "Settings", href: `${base}/settings`, icon: Settings },
    { label: "Help / FAQ", href: "/faq", icon: HelpCircle, external: true },
  ];

  return (
    <TopNav
      brand={{
        label: businessName || tenantSlug,
        sublabel: tenantSlug,
        href: base,
      }}
      items={items}
      overflow={overflow}
      user={{
        name: user?.displayName,
        email: user?.email,
        avatarUrl: getAvatarUrl(user?.email),
      }}
      onLogout={logout}
    />
  );
}
