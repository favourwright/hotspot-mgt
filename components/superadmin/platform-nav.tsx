"use client";

import { Blocks, Building2, CreditCard, LayoutDashboard, Mail, Settings, Tags, Ticket } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { getAvatarUrl } from "@/lib/utils";

export function SuperAdminNav() {
  const { user, logout } = useAuth();

  // The four places the day actually gets spent. TopNav's own guidance is
  // to keep this group to about five: past that it stops reading as one
  // object and starts crowding the brand.
  const items: NavItem[] = [
    { label: "Overview", href: "/superadmin", icon: LayoutDashboard, exact: true },
    { label: "Tenants", href: "/superadmin/tenants", icon: Building2 },
    { label: "Billing", href: "/superadmin/billing", icon: CreditCard },
    { label: "Plans", href: "/superadmin/billing-plans", icon: Tags },
  ];

  // Set up once and revisited rarely. Same arrangement the customer nav
  // already uses for Help.
  const overflow: NavItem[] = [
    { label: "Addons", href: "/superadmin/addons", icon: Blocks },
    { label: "Promo codes", href: "/superadmin/coupons", icon: Ticket },
    { label: "Emails", href: "/superadmin/emails", icon: Mail },
    { label: "Config", href: "/superadmin/config", icon: Settings },
  ];

  return (
    <TopNav
      brand={{ label: "Super Admin", sublabel: "platform", href: "/superadmin" }}
      items={items}
      overflow={overflow}
      user={{
        name: user?.displayName,
        email: user?.email,
        avatarUrl: getAvatarUrl(user?.uid),
      }}
      onLogout={logout}
    />
  );
}
