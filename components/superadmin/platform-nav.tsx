"use client";

import { Building2, CreditCard, LayoutDashboard, Mail, Settings, Tags } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { getAvatarUrl } from "@/lib/utils";

export function SuperAdminNav() {
  const { user, logout } = useAuth();

  const items: NavItem[] = [
    { label: "Overview", href: "/superadmin", icon: LayoutDashboard, exact: true },
    { label: "Tenants", href: "/superadmin/tenants", icon: Building2 },
    { label: "Billing", href: "/superadmin/billing", icon: CreditCard },
    { label: "Plans", href: "/superadmin/billing-plans", icon: Tags },
    { label: "Emails", href: "/superadmin/emails", icon: Mail },
    { label: "Config", href: "/superadmin/config", icon: Settings },
  ];

  return (
    <TopNav
      brand={{ label: "Super Admin", sublabel: "platform", href: "/superadmin" }}
      items={items}
      user={{
        name: user?.displayName,
        email: user?.email,
        avatarUrl: getAvatarUrl(user?.email),
      }}
      onLogout={logout}
    />
  );
}
