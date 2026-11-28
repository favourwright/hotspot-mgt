"use client";

import Link from "next/link";
import { HelpCircle, Ticket, UserRound, Wifi } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useAuth } from "@/providers/auth-provider";
import { TopNav, type NavItem } from "@/components/system/top-nav";
import { Button } from "@/components/system/button";
import { getAvatarUrl } from "@/lib/utils";
import { tenantHref } from "@/lib/tenant-url";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { NoticeStack } from "@/components/system/notice-stack";
import { useTenantLogo } from "@/components/tenant/tenant-brand";

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
  const logo = useTenantLogo();

  // Signed-out visitors get the storefront only -- "My Vouchers" would just
  // bounce them to sign-in, so it isn't offered until there's a session.
  const items: NavItem[] = [
    { label: "Buy Data", href: tenantHref(slug), icon: Wifi, exact: true },
    ...(user
      ? [
          { label: "My Vouchers", href: tenantHref(slug, "/my-vouchers"), icon: Ticket },
          { label: "Account", href: tenantHref(slug, "/profile"), icon: UserRound },
        ]
      : []),
  ];

  return (
    <>
      <TopNav
      brand={{ label: businessName, iconSeed: slug, logo, href: tenantHref(slug) }}
      items={items}
      overflow={[
        { label: "Help / FAQ", href: "/faq", icon: HelpCircle, external: true },
      ]}
      user={
        user
          ? {
              name: user.displayName,
              email: user.email,
              avatarUrl: getAvatarUrl(user.uid),
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

      {/*
        Mounted here, and only here, for every customer-facing page.
        
        AppShell lays its children out as bands (nav / title / content), so a
        fragment puts this directly under the nav on every page with no
        per-page wiring - which is the point. The alternative was dropping it
        into each page, and that is exactly how it ended up on two of them,
        missing from the rest, and once rendered outside the shell entirely.

        The portal page does not render this nav, so a buyer mid-purchase is
        never nagged about an inbox they cannot reach from behind the paywall.
        That falls out of the placement rather than needing a condition.
      */}
      {/* The same region as the admin side, so a notice sits in the same
          place whichever half of the app you are in. Only one notice
          applies to customers today; the stack is what stops the second one
          being placed by whoever adds it. */}
      <NoticeStack>
        <EmailVerificationNotice audience="customer" />
      </NoticeStack>
    </>
  );
}
