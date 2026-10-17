"use client";

import { useErrorState } from "@/components/system/use-error-state";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { usePaystackInline } from "@/hooks/use-paystack";
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
import { tenantHref } from "@/lib/tenant-url";
import { formatDeviceCount } from "@/lib/utils";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  locationName?: string;
  subaccountCode: string | null;
  bearer: "account" | "subaccount";
  tenantId: string;
  tenantSlug: string;
  /**
   * What a purchase would do to the logins this buyer already holds, from
   * the `can-purchase` check the caller has just made. Passed in rather
   * than fetched here so the dialog does not repeat a round trip the
   * storefront already paid for.
   */
  options?: PurchaseOptionsView | null;
}

export function CheckoutDialog({ open, onOpenChange, plan, locationName, subaccountCode, bearer, tenantId, tenantSlug, options }: CheckoutDialogProps) {
  const { user } = useAuth();
  const router = useRouter();
  const { loaded: paystackLoaded, pay } = usePaystackInline();
  const [processing, setProcessing] = useState(false);
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [error, setError] = useErrorState("Checkout failed");
  // The actual amount to be charged - may include Paystack's estimated
  // processing fee on top of the plan price (see docs/billing-and-payments.md).
  // Defaults to the plain listed price until /api/tenant/[slug]/checkout-amount
  // responds, right as payment is initiated.
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
      setProcessing(false);
    } else if (plan) {
      setChargeAmount(plan.price);
      setIntent(null);
    }
    // `setError` is useErrorState's memoised setter, stable for a literal
    // title, so naming it changes nothing about when this runs.
  }, [open, plan, setError]);

  const generateReference = (userId: string): string => {
    return `hs_${Date.now()}_${userId.slice(0, 8)}`;
  };

  const handlePaymentSuccess = async (reference: string) => {
    if (!plan || !user) return;

    setProcessing(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/payment/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reference,
          planId: plan.id,
          locationId: plan.locationId,
          tenantId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Payment verification failed. Please contact support.");
        return;
      }

      onOpenChange(false);
      router.push(tenantHref(tenantSlug, `/voucher?id=${data.data.voucherId}`));
    } catch (error) {
      console.error("Error verifying payment:", error);
      setError("An error occurred while verifying your payment. Please contact support.");
    } finally {
      setProcessing(false);
    }
  };

  const handlePay = async () => {
    if (!plan || !user || !paystackLoaded) return;

    setError(null);
    setPreparingPayment(true);

    try {
      // Authoritative, server-computed amount/split - may include Paystack's
      // estimated processing fee on top of the plan price (see
      // docs/billing-and-payments.md). Never trust a client-computed amount
      // for real money; this is why the dialog doesn't show an itemized fee
      // breakdown either - it only ever displays one combined total.
      const token = await user.getIdToken();
      const amountResponse = await fetch(
        `/api/tenant/${tenantSlug}/checkout-amount?planId=${plan.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const amountResult = await amountResponse.json();

      if (!amountResult.success) {
        setError(amountResult.error || "Failed to prepare payment. Please try again.");
        return;
      }

      const { amount, transactionCharge } = amountResult.data;
      setChargeAmount(amount);

      const reference = generateReference(user.uid);

      const paystackConfig: Record<string, unknown> = {
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: user.email!,
        amount,
        reference: reference,
        metadata: {
          planId: plan.id,
          locationId: plan.locationId,
          tenantId,
          // Carried so the `charge.success` webhook can fulfil this sale on
          // its own if the browser never gets back to /api/payment/verify.
          // Without it the webhook has to resolve the buyer by email.
          userId: user?.uid,
          // The buyer's own answer, attached to the charge rather than to
          // the request, so the webhook and the reconciliation cron fulfil
          // it the same way this browser would have.
          intent: intent ?? "reuse",
        },
        onSuccess: (transaction: { reference: string }) => handlePaymentSuccess(transaction.reference),
        onCancel: () => {
          // User closed the payment modal
        },
        onError: (error: { message: string }) => {
          console.error("Paystack error:", error);
          setError(error.message || "An error occurred during payment initialization.");
        },
      };

      // Add subaccount split if tenant has one
      if (subaccountCode) {
        paystackConfig.subaccount = subaccountCode;
        paystackConfig.bearer = bearer;
        if (transactionCharge !== null) {
          paystackConfig.transaction_charge = transactionCharge;
        }
      }

      pay(paystackConfig);
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

          {processing ? (
            <div className="py-8">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                <p className="text-sm text-muted-foreground">
                  Verifying payment and generating your voucher...
                </p>
              </div>
            </div>
          ) : (
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

              {/* Cancel then confirm, side by side, like every other
                  dialog in the app. DialogFooter shares the row evenly at
                  `sm` and up and stacks below it, so a phone still gets
                  full-width targets. */}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={processing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePay}
                  disabled={
                    !paystackLoaded ||
                    processing ||
                    preparingPayment ||
                    needsAnswer
                  }
                >
                  {!paystackLoaded
                    ? "Loading..."
                    : preparingPayment
                      ? "Preparing payment..."
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
