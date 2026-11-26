"use client";

import { useErrorState } from "@/components/system/use-error-state";
import { useState, useEffect } from "react";
import { useAuth } from "@/providers/auth-provider";
import { leaveForCheckout } from "@/lib/checkout-return";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plan } from "@/types/schemas";
import {
  PurchaseIntentChoice,
  UnusedVoucherNotice,
  type PurchaseOptionsView,
} from "@/components/shared/purchase-intent-choice";
import type { PurchaseIntent } from "@/lib/voucher-renewal";
import { linkStartHref } from "@/lib/link-start-href";
import { formatDeviceCount } from "@/lib/utils";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  locationName?: string;
  tenantSlug: string;
  /**
   * What a purchase would do to the logins this buyer already holds, from
   * the `can-purchase` check the caller has just made. Passed in rather
   * than fetched here so the dialog does not repeat a round trip the
   * storefront already paid for.
   */
  options?: PurchaseOptionsView | null;
}

export function CheckoutDialog({ open, onOpenChange, plan, locationName, tenantSlug, options }: CheckoutDialogProps) {
  const { user } = useAuth();
  // On its way to the checkout: the page is about to leave.
  const [leaving, setLeaving] = useState(false);
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [error, setError] = useErrorState("Checkout failed");
  // Set when the business's decision hook asks to verify this customer.
  const [linkHref, setLinkHref] = useState<string | null>(null);
  // The actual amount to be charged - may include the passed-on
  // processing fee on top of the plan price (see docs/billing-and-payments.md).
  // Defaults to the plain listed price until /api/purchase/initiate
  // responds, right as payment is started.
  const [chargeAmount, setChargeAmount] = useState(plan?.price ?? 0);
  // Null until the buyer answers. Nothing is preselected on purpose: an
  // automatic decision here is what sent three codes onto one login. When
  // there is nothing to decide the choice never renders and this stays
  // null, which the server reads as the default.
  const [intent, setIntent] = useState<PurchaseIntent | null>(null);

  useEffect(() => {
    // Reset state when dialog opens/closes
    if (!open) {
      setError(null);
      setLeaving(false);
    } else if (plan) {
      setChargeAmount(plan.price);
      setIntent(null);
    }
    // `setError` is useErrorState's memoised setter, stable for a literal
    // title, so naming it changes nothing about when this runs.
  }, [open, plan, setError]);

  const handlePay = async () => {
    if (!plan || !user) return;

    setError(null);
    setPreparingPayment(true);

    try {
      // The server starts the transaction: it checks this buyer may
      // purchase, works out the amount and split, records what was agreed
      // and starts the charge at Knomad Pay. The checkout below can only pay
      // that charge, so nothing in this browser decides the price, the
      // split or whose sale it is. See app/api/purchase/initiate/route.ts.
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
          // The buyer's own answer, kept with the checkout so the webhook
          // and the reconciliation cron fulfil it the way this browser
          // would have. Null means nothing was asked.
          intent,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        setLinkHref(result.data?.canLink ? linkStartHref(tenantSlug) : null);
        setError(result.error || "Failed to prepare payment. Please try again.");
        return;
      }

      const { amount, checkoutUrl, reference } = result.data as {
        amount: number;
        checkoutUrl: string;
        reference: string;
      };
      // May include the passed-on processing fee on top of the plan price
      // (docs/billing-and-payments.md); shown as one combined total.
      setChargeAmount(amount);
      // Monnify's checkout, full screen. It comes back to this tenant's
      // /payment-return, which confirms the sale and opens the voucher.
      setLeaving(true);
      leaveForCheckout(checkoutUrl, reference, { kind: "voucher", portal: null });
    } catch (error) {
      console.error("Error initializing payment:", error);
      setError("Failed to initialize payment. Please try again.");
    } finally {
      setPreparingPayment(false);
    }
  };

  if (!plan) return null;

  // The button says why it is disabled rather than just being dead. The
  // question is only ever asked when the choice renders, so this is false
  // for a first purchase and the flow is unchanged.
  const needsAnswer = Boolean(options?.reuse) && intent === null;

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-150">
          <DialogHeader>
            <DialogTitle>Checkout</DialogTitle>
            <DialogDescription>Review your order and proceed to payment</DialogDescription>
          </DialogHeader>

          {(
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-3">Order Summary</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Plan:</span>
                    <span className="font-medium">{plan.name}</span>
                  </div>
                  {locationName && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Location:</span>
                      <span className="font-medium">{locationName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Duration:</span>
                    <span className="font-medium">{plan.duration}</span>
                  </div>
                  {plan.dataLimit && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Data Limit:</span>
                      <span className="font-medium">{plan.dataLimit}</span>
                    </div>
                  )}
                  {formatDeviceCount(plan.sharedUsers) && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Devices:</span>
                      <span className="font-medium">
                        {formatDeviceCount(plan.sharedUsers)}
                      </span>
                    </div>
                  )}
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">Total:</span>
                      <span className="text-xl font-bold">
                        ₦{(chargeAmount / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <PurchaseIntentChoice
                options={options ?? null}
                value={intent}
                onChange={setIntent}
                planDuration={plan.duration}
              />
              <UnusedVoucherNotice options={options ?? null} />

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {/* The business's own check doesn't know this account yet and
                  can verify it on their site. Only ever shown under the
                  reason it gave, never on its own. */}
              {error && linkHref && (
                <Button className="w-full" onClick={() => window.location.assign(linkHref)}>
                  Verify your account
                </Button>
              )}

              {/* Cancel then confirm, side by side, like every other
                  dialog in the app. DialogFooter shares the row evenly at
                  `sm` and up and stacks below it, so a phone still gets
                  full-width targets. */}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={leaving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePay}
                  disabled={
                    leaving ||
                    preparingPayment ||
                    needsAnswer
                  }
                >
                  {preparingPayment || leaving
                      ? "Opening payment..."
                      : needsAnswer
                        ? "Choose who this is for"
                        : `Pay ₦${(chargeAmount / 100).toFixed(2)}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
  );
}
