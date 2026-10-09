import { notFound } from "next/navigation";

import { requireTenant } from "@/lib/tenant-context";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlans } from "@/lib/firestore-helpers";
import { parsePortalSession, withDevFallback } from "@/lib/captive-portal";
import { lastVoucherForDevice } from "@/lib/hotspot-portal";
import { getPortalCheckoutConfig } from "@/lib/portal-checkout";
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

  const [plansSnapshot, lastVoucher] = await Promise.all([
    adminDb
      .collection(TENANT_COLLECTIONS.plans(tenant.id))
      .where("active", "==", true)
      .get(),
    // Costs one read, and only when the router told us the MAC.
    lastVoucherForDevice(tenant.id, session.mac),
  ]);
  const plans = parsePlans(plansSnapshot.docs);

  // Amount, split and customer-limit check, all resolved here rather than
  // through the authenticated checkout APIs -- a guest on the paywall has no
  // token to call those with. See lib/portal-checkout.ts.
  const checkout = await getPortalCheckoutConfig(tenant, plans, session.mac);

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

        {lastVoucher && lastVoucher.status !== "active" && (
          // A device we've sold to before. Saying so turns an anonymous
          // form into something that acknowledges them.
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

        <SurfaceCard>
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
