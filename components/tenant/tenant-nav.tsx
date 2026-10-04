"use client";

import Link from "next/link";
import { HelpCircle, Ticket, Wifi } from "lucide-react";
import { signOut } from "firebase/auth";

import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/stores/auth-store";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { Button } from "@/components/system/button";
import { getAvatarUrl } from "@/lib/utils";

interface TenantNavProps {
  businessName: string;
  slug: string;
}

export function TenantNav({ businessName, slug }: TenantNavProps) {
  const { user } = useAuthStore();

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
    }
  };

  // Signed-out visitors get the storefront only -- "My Vouchers" would just
  // bounce them to sign-in, so it isn't offered until there's a session.
  const items: NavItem[] = [
    { label: "Buy Data", href: `/${slug}`, icon: Wifi, exact: true },
    ...(user
      ? [{ label: "My Vouchers", href: `/${slug}/my-vouchers`, icon: Ticket }]
      : []),
  ];

  return (
    <TopNav
      brand={{ label: businessName, href: `/${slug}` }}
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
      onLogout={user ? handleLogout : undefined}
      action={
        user ? undefined : (
          <Button
            tone="action"
            scale="sm"
            nativeButton={false}
            render={<Link href={`/auth?redirect=/${slug}`} />}
          >
            Sign in
          </Button>
        )
      }
    />
  );
}
