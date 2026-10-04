import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Database, Wifi } from "lucide-react";

import { requireTenant } from "@/lib/tenant-context";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlans } from "@/lib/firestore-helpers";
import { formatNaira } from "@/lib/utils";
import { parsePortalSession, withDevFallback } from "@/lib/captive-portal";
import { lastVoucherForDevice } from "@/lib/hotspot-portal";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { Amount } from "@/components/system/amount";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { PortalLogin } from "@/components/portal/portal-login";

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
            {plans.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Wifi />
                  </EmptyMedia>
                  <EmptyTitle>No plans available</EmptyTitle>
                  <EmptyDescription>
                    This network doesn&apos;t have any plans on sale yet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((plan) => (
                  <SurfaceCard key={plan.id} tone="sunken" className="flex flex-col">
                    <SurfaceCardHeader>
                      <SurfaceCardTitle className="text-base">
                        {plan.name}
                      </SurfaceCardTitle>
                      <SurfaceCardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5 shrink-0" />
                          {plan.duration}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Database className="size-3.5 shrink-0" />
                          {plan.dataLimit || "Unlimited"}
                        </span>
                      </SurfaceCardDescription>
                    </SurfaceCardHeader>
                    <SurfaceCardContent inset={false} className="flex-1">
                      <Amount
                        value={formatNaira(plan.price)}
                        className="text-2xl font-semibold tracking-tight"
                      />
                    </SurfaceCardContent>
                    <SurfaceCardFooter>
                      <Button
                        tone="accent"
                        className="w-full"
                        nativeButton={false}
                        render={
                          <Link
                            href={`/${tenant.slug}?plan=${plan.id}&from=portal`}
                          />
                        }
                      >
                        Buy now
                      </Button>
                    </SurfaceCardFooter>
                  </SurfaceCard>
                ))}
              </div>
            )}
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
