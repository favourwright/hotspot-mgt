import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireTenant } from "@/lib/tenant-context";
import { getCachedActivePlans } from "@/lib/plans-cache";
import {
  parsePortalSession,
  portalHref,
  withDevFallback,
} from "@/lib/captive-portal";
import { getPortalCheckoutConfig } from "@/lib/portal-checkout";
import { getEntitlementState } from "@/lib/entitlements";
import { getPortalBranding } from "@/lib/portal-branding";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PortalPlans } from "@/components/portal/portal-plans";
import { PortalSupport } from "@/components/portal/portal-support";
import { PortalUnavailable } from "@/components/portal/portal-unavailable";
import { PortalBrandHeader } from "@/components/portal/portal-brand-header";

interface PortalPlansPageProps {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The plan list, split off the portal itself.
 *
 * Everything that costs a captive-portal visitor time lives here rather
 * than on the page the router drops them on: the plan grid, the checkout
 * dialog and Monnify's checkout frame. A customer with a voucher in their
 * hand never loads any of it.
 *
 * **The session query string is load-bearing.** `mac`, `link-login-only`
 * and `link-orig` reach us only on the first page the router redirects to,
 * so the link here carries them and `portalSessionQuery` is the one place
 * that builds it. Without `link-login-only` a paid-for voucher cannot be
 * handed to the router, and without `mac` the purchase carries no
 * `deviceMac`, which is what `/api/payment/verify` keys on to return the
 * credentials at all. Both fail silently.
 *
 * Deliberately has no nav, same as the portal: this renders inside the
 * cramped captive-portal browser, where every link out is a dead end until
 * the client is actually online.
 */
export default async function PortalPlansPage({
  params,
  searchParams,
}: PortalPlansPageProps) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  const session = withDevFallback(parsePortalSession(await searchParams));

  // Re-checked here, not inherited from the portal page. These are separate
  // requests, and a plan list that kept selling after the addon lapsed
  // would be a paywall with a hole in it.
  const entitlement = await getEntitlementState(tenant.id, "captive-portal");
  if (!entitlement.entitled) {
    console.warn(
      `[portal] ${tenantSlug} plans blocked: captive-portal ${entitlement.reason}`
    );
    return <PortalUnavailable businessName={tenant.businessName} />;
  }

  const plans = await getCachedActivePlans(tenant.id);

  // Amount, split and customer-limit check, all resolved here rather than
  // through the authenticated checkout APIs -- a guest on the paywall has no
  // token to call those with. See lib/portal-checkout.ts.
  const checkout = await getPortalCheckoutConfig(tenant, plans);

  // No Firestore read: the plan lookup is cached, and a tenant with nothing
  // saved skips even that.
  const branding = await getPortalBranding(tenant.planId, tenant.branding);

  return (
    <AppShell>
      <PageContent width="prose" className="py-6">
        <PortalBrandHeader
          businessName={tenant.businessName}
          subtitle="Pick a plan to get online"
          branding={branding}
        />

        <PortalPlans
          plans={plans}
          session={session}
          tenantSlug={tenantSlug}
          checkout={checkout}
        />

        <PortalSupport
          supportPhone={tenant.supportPhone}
          isWhatsapp={tenant.supportPhoneIsWhatsapp}
          businessName={tenant.businessName}
        />

        <p className="text-center text-sm">
          <Link
            href={portalHref(`/${tenantSlug}/portal`, session)}
            className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            Back to sign-in
          </Link>
        </p>
      </PageContent>
    </AppShell>
  );
}
