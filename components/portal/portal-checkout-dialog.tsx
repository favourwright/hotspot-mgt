"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { leaveForCheckout } from "@/lib/checkout-return";
import { useAuth } from "@/providers/auth-provider";
import { useErrorState } from "@/components/system/use-error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Button } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatDeviceLimit, formatNaira } from "@/lib/utils";
import type { PortalSession } from "@/lib/captive-portal";
import type { Plan } from "@/types/schemas";
import {
  PurchaseIntentChoice,
  UnusedVoucherNotice,
  type PurchaseOptionsView,
} from "@/components/shared/purchase-intent-choice";
import type { PurchaseIntent } from "@/lib/voucher-renewal";
import { linkStartHref } from "@/lib/link-start-href";

interface PortalCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  session: PortalSession;
  tenantSlug: string;
  /**
   * Server-computed, in kobo, fee passthrough already applied. For display:
   * the charge itself is created by /api/purchase/initiate.
   */
  amount: number;
}

/**
 * Buying a plan from the captive portal.
 *
 * Requires a signed-in account, like every other purchase path. This used to
 * be the guest branch, on the reasoning that someone behind a paywall cannot
 * sign up because the confirmation email is on the far side of the internet
 * they are buying. That reasoning does not apply here: registration is plain
 * email and password with no verification step, so it only talks to Firebase,
 * and `*.googleapis.com` is already in the walled garden. PortalPlans sends
 * anyone without an account to `/auth?next=` before this dialog ever opens.
 *
 * The device MAC still travels with the purchase, but as a *label* rather
 * than an identity: it is what lets the router log this device straight in
 * after payment.
 *
 * The amount shown arrives as a prop, computed while the page rendered. The
 * charge itself is created by /api/purchase/initiate, which works the amount
 * out again and records it; fulfilment checks the payment against that.
 */
export function PortalCheckoutDialog({
  open,
  onOpenChange,
  plan,
  session,
  tenantSlug,
  amount,
}: PortalCheckoutDialogProps) {
  const { user } = useAuth();
  const [checking, setChecking] = useState(false);
  // On its way to the checkout: the page is about to leave.
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useErrorState("Checkout failed");
  // Set when the business's decision hook asks to verify this customer.
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [options, setOptions] = useState<PurchaseOptionsView | null>(null);
  // Null until the buyer answers. Nothing is preselected: an automatic
  // decision here is what put three separate purchases onto one login.
  const [intent, setIntent] = useState<PurchaseIntent | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setError(null);
      setLeaving(false);
      setOptions(null);
      setIntent(null);
      setBlockedReason(null);
    }
  }, [open, setError]);

  // The availability check moved here from `handlePay`, because its answer
  // is no longer only a yes or no: it also says what a purchase would do to
  // the logins this buyer already holds, and that has to be on screen
  // *before* the checkout opens rather than a moment after it opens.
  //
  // Same trade the storefront already makes. The window between this and
  // the tap is seconds, and the thing it gates is a tenant's customer cap,
  // not money.
  useEffect(() => {
    if (!open || !plan || !user) return;
    let cancelled = false;

    (async () => {
      setChecking(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/tenant/${tenantSlug}/can-purchase?planId=${encodeURIComponent(
            plan.id
          )}&locationId=${encodeURIComponent(plan.locationId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (cancelled) return;

        if (!response.ok || !data.success) {
          setBlockedReason("We couldn't check availability. Please try again.");
          return;
        }

        setOptions(data.data.options ?? null);
        setBlockedReason(
          data.data.allowed
            ? null
            : data.data.reason ||
                "This network isn't accepting new customers right now."
        );
      } catch {
        if (!cancelled) {
          setBlockedReason("We couldn't check availability. Please try again.");
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, plan, user, tenantSlug]);

  const handlePay = async () => {
    if (!plan || !user) return;
    setError(null);

    // The maxCustomers gate was resolved when the dialog opened, and the
    // button is disabled while it stands - this is the belt to that
    // braces, so a stale render cannot start a charge we would refuse.
    if (blockedReason) {
      setError(blockedReason);
      return;
    }

    try {
      // The server starts the charge and records what was agreed; the checkout
      // can only pay that. See app/api/purchase/initiate.
      const token = await user.getIdToken();
      const response = await fetch("/api/purchase/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tenantSlug,
          planId: plan.id,
          locationId: plan.locationId,
          // Kept with the checkout so the `charge.success` webhook can
          // fulfil this sale, and log this device in, without the browser.
          // This is the flow where that matters most: the buyer is behind
          // the paywall and the bank's 3DS step navigates the page away,
          // which is exactly how a real payment once produced no voucher,
          // no record and no email.
          deviceMac: session.mac ?? null,
          deviceIp: session.ip ?? null,
          // The buyer's own answer, so the webhook and the reconciliation
          // cron fulfil it the way this browser would.
          intent,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setLinkHref(result.data?.canLink ? linkStartHref(tenantSlug) : null);
        setError(result.error || "Payment couldn't be started.");
        return;
      }

      // Monnify's checkout, full screen. It comes back to this tenant's
      // /payment-return, which shows the voucher and logs this device in with the
      // session kept here (lib/checkout-return.ts).
      setLeaving(true);
      leaveForCheckout(result.data.checkoutUrl, result.data.reference, { kind: "voucher", portal: session });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Payment couldn't be started."
      );
    }
  };

  if (!plan) return null;

  // Says why it is disabled rather than just being dead. Only ever true
  // when the choice is on screen, so a first purchase is unaffected.
  const needsAnswer = Boolean(options?.reuse) && intent === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>{plan.name}</DialogTitle>
          <DialogDescription>
            {[
              plan.duration,
              `${plan.dataLimit || "Unlimited"} data`,
              formatDeviceLimit(plan.sharedUsers),
            ]
              .filter(Boolean)
              .join(" · ")}
          </DialogDescription>
        </DialogHeader>

        {(
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {/* The business's own check doesn't know this account yet and
                can verify it on their site. Their site has to be in the
                router's walled garden for this to load from the portal. */}
            {error && linkHref && (
              <Button tone="field" className="w-full" onClick={() => window.location.assign(linkHref)}>
                Verify your account
              </Button>
            )}

            {/* Rendered, not just used to disable the button. The check
                moved to dialog-open, so without this the buyer would face
                a dead Pay button and no reason for it. */}
            {blockedReason && !error && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertDescription>{blockedReason}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-panel bg-sunken p-3">
              <p className="text-xs text-muted-foreground">Billed to</p>
              <p className="text-sm font-medium">{user?.email}</p>
            </div>

            <PurchaseIntentChoice
              options={options}
              value={intent}
              onChange={setIntent}
              planDuration={plan.duration}
            />
            <UnusedVoucherNotice options={options} />

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-semibold tracking-tight">
                {formatNaira(amount)}
              </span>
            </div>

            {/* Cancel then confirm, side by side. DialogFooter stacks them
                below `sm`, so a phone behind the paywall still gets
                full-width targets. */}
            <DialogFooter>
              <Button tone="raised" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                tone="accent"
                onClick={handlePay}
                disabled={
                  !user ||
                  checking ||
                  leaving ||
                  Boolean(blockedReason) ||
                  needsAnswer
                }
              >
                {checking
                  ? "Checking..."
                  : leaving
                    ? "Opening payment..."
                  : needsAnswer
                      ? "Choose who this is for"
                      : `Pay ${formatNaira(amount)}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
