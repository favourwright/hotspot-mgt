import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { portalHref, type PortalSession } from "@/lib/captive-portal";

interface PortalBuyCtaProps {
  tenantSlug: string;
  session: PortalSession;
  /**
   * The plan a device we have sold to before has just run out of, if there
   * is one. Changes the copy from an offer into an acknowledgement.
   */
  endedPlanName?: string | null;
}

/**
 * The way from the portal to the plan list.
 *
 * The plans used to render on the portal itself, which meant every device
 * that joined the wifi downloaded the plan grid, the checkout dialog and
 * Paystack's inline script before it could type a voucher code. Most of
 * them already had one. The portal's first job is the sign-in fields, so
 * buying is a link now and the weight moves to the page that needs it.
 *
 * A server component: a `<Link>` with a precomputed href needs no client
 * JavaScript, which is the entire point of the split.
 *
 * `tone="raised"`, never `action`. The design language allows one `action`
 * per page and the portal's is Connect -- two near-black pills would make
 * the secondary path look like the primary one, which is the arrangement
 * this change exists to undo.
 *
 * This is also where a returning customer is greeted, rather than in a card
 * of its own above the form. Saying "your plan has ended" and then offering
 * plans somewhere else makes the customer find the way out; the two belong
 * in the same card, and the portal stays at two cards total.
 */
export function PortalBuyCta({
  tenantSlug,
  session,
  endedPlanName,
}: PortalBuyCtaProps) {
  const href = portalHref(`/${tenantSlug}/portal/plans`, session);
  const returning = endedPlanName !== undefined && endedPlanName !== null;

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>
          {returning ? "Welcome back" : "No voucher?"}
        </SurfaceCardTitle>
        <SurfaceCardDescription>
          {returning
            ? `Your ${endedPlanName || "previous"} plan has ended. Pick a plan to get back online.`
            : "Pick a plan and pay to get online right away."}
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardFooter>
        <Button tone="field" className="w-full" render={<Link href={href} />}>
          Buy one now
          <ArrowRight />
        </Button>
      </SurfaceCardFooter>
    </SurfaceCard>
  );
}
