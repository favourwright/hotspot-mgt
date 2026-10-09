"use client";

import { useState } from "react";
import { Clock, Database, Wifi } from "lucide-react";

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
import type { PortalSession } from "@/lib/captive-portal";
import type { PortalCheckoutConfig } from "@/lib/portal-checkout";
import type { Plan } from "@/types/schemas";

interface PortalPlansProps {
  plans: Plan[];
  session: PortalSession;
  tenantId: string;
  checkout: PortalCheckoutConfig;
}

/**
 * The plan grid on the captive portal. Client-side because buying happens
 * right here, in a dialog, rather than by linking out to the tenant's
 * customer page -- that page asks for a sign-in, which is exactly what
 * someone with no internet cannot do.
 */
export function PortalPlans({
  plans,
  session,
  tenantId,
  checkout,
}: PortalPlansProps) {
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const openCheckout = (plan: Plan) => {
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
                disabled={!!checkout.blockedReason}
                onClick={() => openCheckout(plan)}
              >
                Buy now
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
        amount={pricing?.amount ?? selectedPlan?.price ?? 0}
        transactionCharge={pricing?.transactionCharge ?? null}
        subaccountCode={checkout.subaccountCode}
        bearer={checkout.paystackBearer}
      />
    </>
  );
}
