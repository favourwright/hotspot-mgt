"use client";

import {
  AlertTriangle,
  Blocks,
  ChartColumn,
  CodeXml,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  MapPin,
  Receipt,
  ServerCog,
  Settings,
  Ticket,
  TicketPlus,
  Users,
} from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { getAvatarUrl } from "@/lib/utils";
import { tenantBasePath } from "@/lib/tenant-url";
import { DEVELOPER_PAGES } from "@/components/admin/developer-tabs";

interface TenantAdminNavProps {
  tenantSlug: string;
  businessName: string;
  /** Has a router and a location. Resolved on the server by the admin layout. */
  setupComplete: boolean;
}

export function TenantAdminNav({
  tenantSlug,
  businessName,
  setupComplete,
}: TenantAdminNavProps) {
  const { user, logout } = useAuth();
  // Empty on a subdomain deployment: the host already names the tenant.
  const base = `${tenantBasePath(tenantSlug)}/admin`;

  const dashboard: NavItem = { label: "Dashboard", href: base, icon: LayoutDashboard, exact: true };
  const routers: NavItem = { label: "Routers", href: `${base}/routers`, icon: ServerCog };
  const locations: NavItem = { label: "Locations", href: `${base}/locations`, icon: MapPin };
  const plans: NavItem = { label: "Plans", href: `${base}/plans`, icon: CreditCard };
  const vouchers: NavItem = { label: "Vouchers", href: `${base}/vouchers`, icon: Ticket };
  const users: NavItem = { label: "Users", href: `${base}/users`, icon: Users };
  const transactions: NavItem = { label: "Transactions", href: `${base}/transactions`, icon: Receipt };
  const reports: NavItem = { label: "Reports", href: `${base}/reports`, icon: ChartColumn };
  const generate: NavItem = { label: "Generate codes", href: `${base}/generate`, icon: TicketPlus };

  // Everything below the daily pages, the same in both states. Failed Queue
  // has no pill because the dashboard already surfaces it.
  const rest: NavItem[] = [
    { label: "Addons", href: `${base}/addons`, icon: Blocks },
    { label: "Failed Queue", href: `${base}/failed`, icon: AlertTriangle },
    { label: "Settings", href: `${base}/settings`, icon: Settings },
    // One entry for hooks, API keys and webhooks: most tenants never open
    // them. The pages switch between themselves (components/admin/developer-tabs.tsx).
    {
      label: "Developers",
      href: `${base}/${DEVELOPER_PAGES[0].path}`,
      icon: CodeXml,
      match: DEVELOPER_PAGES.map((p) => `${base}/${p.path}`),
    },
    { label: "Help / FAQ", href: "/faq", icon: HelpCircle, external: true },
  ];

  // Two fixed layouts and exactly one switch between them, which happens once
  // in a tenant's life. Keep it that way: a pill that appears for some
  // tenants and not others makes the nav impossible to predict, so a new page
  // goes into the overflow by default, and earns a pill only by being used
  // more than one already there, which it then replaces. Five pills at most
  // (see TopNav).
  //
  // Setting up: the order the dashboard walks them through, router then
  // location then plan. Users and Transactions would be empty anyway.
  //
  // Set up: the daily work, which is money, codes, customers and pricing.
  // Routers and Locations are visited when something is wrong, and the
  // router-offline notice (components/tenant/router-offline-notice.tsx) is
  // what brings the owner to them now; without it they could not leave the
  // bar. Reports stays out because the dashboard carries the month's figures
  // and trends, and Reports is the deeper monthly look.
  const items: NavItem[] = setupComplete
    ? [dashboard, transactions, vouchers, users, plans]
    : [dashboard, routers, locations, plans, vouchers];

  const overflow: NavItem[] = setupComplete
    ? [reports, generate, routers, locations, ...rest]
    : [users, transactions, reports, generate, ...rest];

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
