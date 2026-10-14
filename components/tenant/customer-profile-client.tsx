"use client";

import { useEffect } from "react";

import { useAuth } from "@/providers/auth-provider";
import { authUrlWithNext } from "@/lib/safe-redirect";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PageHeader } from "@/components/system/page-header";
import { TenantNav } from "@/components/tenant/tenant-nav";
import { LoadingSpinner } from "@/components/shared/loading-spinner";
import { AccountEmailCard } from "@/components/auth/account-email-card";

/**
 * A customer's account page.
 *
 * Shaped like every other customer page rather than like an admin one: the
 * shell, the nav and the page content wrapper all come from here, because on
 * this side of the app each page brings its own chrome (see
 * `vouchers-client.tsx`) - the tenant layout only handles the suspended case.
 * A page that renders bare `PageContent` gets no nav at all, which is what
 * the first version of this did.
 *
 * It holds one thing: the email address and the ability to correct it. That
 * is the whole reason it exists - verification without a way to change a
 * wrong address is a dead end, and a customer who typed `gmial.com` at signup
 * previously had no route back at all.
 */
export function CustomerProfileClient({
  tenantSlug,
  businessName,
}: {
  tenantSlug: string;
  businessName: string;
}) {
  const { user, loading } = useAuth();

  // Nothing here means anything without an account, so a signed-out visitor
  // goes to sign in and comes back - the same `?next=` round trip the portal
  // uses, and necessary for the same reason: Firebase persists auth per
  // origin, so a tenant subdomain cannot know who is there without it.
  useEffect(() => {
    if (loading || user) return;
    window.location.assign(authUrlWithNext(window.location.href));
  }, [loading, user]);

  if (loading || !user) {
    return (
      <AppShell>
        <TenantNav businessName={businessName} slug={tenantSlug} />
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TenantNav businessName={businessName} slug={tenantSlug} />

      <PageContent>
        <PageHeader
          title="Your account"
          description={`How ${businessName} reaches you`}
        />

        <AccountEmailCard
          accountUid={user.uid}
          description="Your voucher details are sent here, and it is how you sign in."
        />
      </PageContent>
    </AppShell>
  );
}
