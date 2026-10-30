"use client";

import {
  AlertTriangle,
  Blocks,
  CreditCard,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Radio,
  Receipt,
  ServerCog,
  Settings,
  Ticket,
  Users,
  Webhook,
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
    { label: "Hooks", href: `${base}/hooks`, icon: Webhook },
    { label: "API keys", href: `${base}/api-keys`, icon: KeyRound },
    { label: "Webhooks", href: `${base}/webhooks`, icon: Radio },
    { label: "Failed Queue", href: `${base}/failed`, icon: AlertTriangle },
    { label: "Settings", href: `${base}/settings`, icon: Settings },
    { label: "Help / FAQ", href: "/faq", icon: HelpCircle, external: true },
  ];

  return (
    <TopNav
      brand={{
        label: businessName || tenantSlug,
        // The slug, so the icon is the same one the business's public
        // pages show. The label above cannot be used for this: it falls
        // back to the slug before the name has loaded and for a
        // superadmin viewing this tenant, which gave the same business
        // two different icons depending on who was looking.
        iconSeed: tenantSlug,
        sublabel: tenantSlug,
        href: base,
      }}
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
