import { notFound } from "next/navigation";

import { requireTenant } from "@/lib/tenant-context";
import { parsePortalSession, withDevFallback } from "@/lib/captive-portal";
import { lastVoucherForDevice } from "@/lib/hotspot-portal";
import { getEntitlementState } from "@/lib/entitlements";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PortalLogin } from "@/components/portal/portal-login";
import { PortalBuyCta } from "@/components/portal/portal-buy-cta";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";

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
 * **This page is the sign-in fields and nothing else.** The plan grid,
 * checkout dialog and Paystack script moved to `/portal/plans`, reached
 * from the card below the form. Most people arriving here already hold a
 * voucher; making all of them wait for the machinery that sells one is
 * what made tenants complain the portal was slow. What is left is one
 * cached plan-free read and one conditional lookup.
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

  // Costs one read, and only when the router told us the MAC.
  const lastVoucher = await lastVoucherForDevice(tenant.id, session.mac);

  // A device we've sold to before. Saying so turns an anonymous form into
  // something that acknowledges them, and it is said on the buy card rather
  // than in a banner of its own - see PortalBuyCta.
  //
  // Named statuses rather than "not active", because a third one now
  // exists: a renewed voucher is "superseded", and the customer it belongs
  // to is online right now on the newer one. The renewal carries no
  // deviceMac, so the lookup behind `lastVoucher` finds this old row and
  // would otherwise greet a paying customer with "your plan has ended".
  const endedPlanName =
    lastVoucher &&
    (lastVoucher.status === "expired" || lastVoucher.status === "failed")
      ? lastVoucher.planName ?? ""
      : null;

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

        <PortalLogin session={session} tenantSlug={tenantSlug} />

        <PortalBuyCta
          tenantSlug={tenantSlug}
          session={session}
          endedPlanName={endedPlanName}
        />

        {session.mac && (
          <p className="text-center text-xs text-muted-foreground">
            Device {session.mac}
          </p>
        )}
      </PageContent>
    </AppShell>
  );
}
