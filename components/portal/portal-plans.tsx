"use client";

import { useState } from "react";
import { Clock, Database, LogIn, Wifi } from "lucide-react";

import { Amount } from "@/components/system/amount";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardDescription,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PortalCheckoutDialog } from "@/components/portal/portal-checkout-dialog";
import { formatNaira } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { authUrlWithNext } from "@/lib/safe-redirect";
import type { PortalSession } from "@/lib/captive-portal";
import type { PortalCheckoutConfig } from "@/lib/portal-checkout";
import type { Plan } from "@/types/schemas";

interface PortalPlansProps {
  plans: Plan[];
  session: PortalSession;
  tenantId: string;
  tenantSlug: string;
  checkout: PortalCheckoutConfig;
}

/**
 * The plan grid on the captive portal.
 *
 * Buying requires an account, the same as everywhere else in the app. That
 * used to be impossible here: the assumption was that someone behind a
 * paywall cannot sign up, because the confirmation email is on the far side
 * of the internet they are trying to buy.
 *
 * That assumption does not hold for this app. Registration is plain
 * email and password with no verification step and no OAuth popup, so it
 * only ever talks to Firebase, and `*.googleapis.com` is already in the
 * walled garden every install writes (lib/hotspot-portal.ts). A visitor with
 * no data really can create an account from this page.
 *
 * They are sent to `/auth` on this same host, carrying the current URL in
 * `?next=`, so the router session in the query string (`mac`,
 * `link-login-only`, `link-orig`) survives the round trip. Same origin
 * matters: Firebase persists auth per-origin, so signing in on the apex and
 * returning here would leave them signed out again.
 */
export function PortalPlans({
  plans,
  session,
  tenantId,
  tenantSlug,
  checkout,
}: PortalPlansProps) {
  const { user, loading: authLoading } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const openCheckout = (plan: Plan) => {
    if (!user) {
      // Full page load rather than router.push: this leaves the tenant's
      // portal route for a host-neutral one, and carries the session query
      // string through so they land back exactly where they were.
      window.location.assign(authUrlWithNext(window.location.href));
      return;
    }
    setSelectedPlan(plan);
    setCheckoutOpen(true);
  };

  if (plans.length === 0) {
    return (
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
    );
  }

  const pricing = selectedPlan ? checkout.amounts[selectedPlan.id] : undefined;

  return (
    <>
      {checkout.blockedReason && (
        <Alert className="mb-4">
          <AlertDescription>{checkout.blockedReason}</AlertDescription>
        </Alert>
      )}

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
                disabled={!!checkout.blockedReason || authLoading}
                onClick={() => openCheckout(plan)}
              >
                {user ? (
                  "Buy now"
                ) : (
                  <>
                    <LogIn />
                    Sign in to buy
                  </>
                )}
              </Button>
            </SurfaceCardFooter>
          </SurfaceCard>
        ))}
      </div>

      <PortalCheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        plan={selectedPlan}
        session={session}
        tenantId={tenantId}
        tenantSlug={tenantSlug}
        amount={pricing?.amount ?? selectedPlan?.price ?? 0}
        transactionCharge={pricing?.transactionCharge ?? null}
        subaccountCode={checkout.subaccountCode}
        bearer={checkout.paystackBearer}
      />
    </>
  );
}
