import { notFound } from "next/navigation";

import { requireTenant } from "@/lib/tenant-context";
import { getCachedActivePlans } from "@/lib/plans-cache";
import { parsePortalSession, withDevFallback } from "@/lib/captive-portal";
import { lastVoucherForDevice } from "@/lib/hotspot-portal";
import { getPortalCheckoutConfig } from "@/lib/portal-checkout";
import { getEntitlementState } from "@/lib/entitlements";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { PortalLogin } from "@/components/portal/portal-login";
import { PortalPlans } from "@/components/portal/portal-plans";

interface PortalPageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The captive portal.
 *
 * Reached when a client joins a tenant's Wi-Fi and the router intercepts
 * their first request. The router's `login.html` is a shim that redirects
 * here, carrying the session values MikroTik substitutes into it.
 *
 * Deliberately has no nav: this renders inside the cramped captive-portal
 * browser phones pop up, where every link out is a dead end until the
 * client is actually online.
 */
export default async function PortalPage({
  params,
  searchParams,
}: PortalPageProps) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  const session = withDevFallback(parsePortalSession(await searchParams));

  // The paywall that actually bites. The router half of the portal is
  // theirs once installed and we cannot take it back, but this page runs on
  // our infrastructure and is re-checked on every single request, so an
  // addon that lapses stops the portal earning the moment it does.
  //
  // Checked against the addon alone, never tenant.subscriptionStatus: addons
  // are independent of platform access, and a tenant current on one and
  // behind on the other must be judged on the right one. Account suspension
  // is a separate concern handled by requireTenant.
  const entitlement = await getEntitlementState(tenant.id, "captive-portal");
  if (!entitlement.entitled) {
    console.warn(
      `[portal] ${tenantSlug} blocked: captive-portal ${entitlement.reason}`
    );
    return <PortalUnavailable businessName={tenant.businessName} />;
  }

  const [plans, lastVoucher] = await Promise.all([
    // Cached per tenant: this page renders once per device that joins the
    // wifi, so the plan list was the largest per-visitor read left on it.
    getCachedActivePlans(tenant.id),
    // Costs one read, and only when the router told us the MAC.
    lastVoucherForDevice(tenant.id, session.mac),
  ]);

  // Amount, split and customer-limit check, all resolved here rather than
  // through the authenticated checkout APIs -- a guest on the paywall has no
  // token to call those with. See lib/portal-checkout.ts.
  const checkout = await getPortalCheckoutConfig(tenant, plans);

  return (
    <AppShell>
      <PageContent width="prose" className="py-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {tenant.businessName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect to the internet
          </p>
        </div>

        {lastVoucher &&
          (lastVoucher.status === "expired" ||
            lastVoucher.status === "failed") && (
          // A device we've sold to before. Saying so turns an anonymous
          // form into something that acknowledges them.
          //
          // Named statuses rather than "not active", because a third one
          // now exists: a renewed voucher is "superseded", and the customer
          // it belongs to is online right now on the newer one. The renewal
          // carries no deviceMac, so the lookup behind `lastVoucher` finds
          // this old row and would otherwise greet a paying customer with
          // "your plan has ended".
          <SurfaceCard>
            <SurfaceCardHeader>
              <SurfaceCardTitle className="text-base">
                Welcome back
              </SurfaceCardTitle>
              <SurfaceCardDescription>
                Your {lastVoucher.planName || "previous"} plan has ended. Pick
                a plan below to get back online.
              </SurfaceCardDescription>
            </SurfaceCardHeader>
          </SurfaceCard>
        )}

        <PortalLogin session={session} />

        <SurfaceCard id="portal-plans">
          <SurfaceCardHeader>
            <SurfaceCardTitle>Need a voucher?</SurfaceCardTitle>
            <SurfaceCardDescription>
              Pick a plan and pay to get online right away.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent inset={false}>
            <PortalPlans
              plans={plans}
              session={session}
              tenantId={tenant.id}
              tenantSlug={tenantSlug}
              checkout={checkout}
            />
          </SurfaceCardContent>
        </SurfaceCard>

        {session.mac && (
          <p className="text-center text-xs text-muted-foreground">
            Device {session.mac}
          </p>
        )}
      </PageContent>
    </AppShell>
  );
}

/**
 * Shown when the tenant has no captive-portal entitlement.
 *
 * Deliberately says nothing about billing. The audience here is the venue's
 * wifi customers, not the venue, and telling a room full of strangers that
 * this business has not paid its bill would be a gratuitous humiliation on
 * top of an outage. The owner learns about it through the admin UI and
 * their email, where it belongs; the real reason is in the server log.
 */
function PortalUnavailable({ businessName }: { businessName: string }) {
  return (
    <AppShell>
      <PageContent width="prose" className="py-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {businessName}
          </h1>
        </div>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Sign-in is unavailable</SurfaceCardTitle>
            <SurfaceCardDescription>
              This network is not accepting new sign-ins at the moment. Please
              ask at the desk, and they will be able to help you get online.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
        </SurfaceCard>
      </PageContent>
    </AppShell>
  );
}
