"use client";

import Link from "next/link";
import { HelpCircle, Ticket, Wifi } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { Button } from "@/components/system/button";
import { getAvatarUrl } from "@/lib/utils";
import { tenantHref } from "@/lib/tenant-url";

interface TenantNavProps {
  businessName: string;
  slug: string;
}

export function TenantNav({ businessName, slug }: TenantNavProps) {
  const { user } = useAuthStore();
  // The shared logout, not a bare signOut(): it clears the server session
  // cookie first. Signing out of Firebase alone leaves that cookie behind,
  // and the client bootstrap (lib/session-client.ts) would immediately
  // trade it back for a token -- sign-out would appear to do nothing.
  const { logout } = useAuth();

  // Signed-out visitors get the storefront only -- "My Vouchers" would just
  // bounce them to sign-in, so it isn't offered until there's a session.
  const items: NavItem[] = [
    { label: "Buy Data", href: tenantHref(slug), icon: Wifi, exact: true },
    ...(user
      ? [{ label: "My Vouchers", href: tenantHref(slug, "/my-vouchers"), icon: Ticket }]
      : []),
  ];

  return (
    <TopNav
      brand={{ label: businessName, href: tenantHref(slug) }}
      items={items}
      overflow={[
        { label: "Help / FAQ", href: "/faq", icon: HelpCircle, external: true },
      ]}
      user={
        user
          ? {
              name: user.displayName,
              email: user.email,
              avatarUrl: getAvatarUrl(user.email),
            }
          : undefined
      }
      onLogout={user ? logout : undefined}
      action={
        user ? undefined : (
          <Button
            tone="action"
            scale="sm"
            nativeButton={false}
            render={<Link href={`/auth?redirect=${encodeURIComponent(tenantHref(slug))}`} />}
          >
            Sign in
          </Button>
        )
      }
    />
  );
}
