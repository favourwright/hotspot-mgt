"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useAuth } from "@/providers/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plan } from "@/types/schemas";

interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  locationName?: string;
  subaccountCode?: string | null;
  tenantId?: string | null;
}

interface PaystackTransaction {
  reference: string;
  trans?: string;
  status: string;
  message: string;
  transaction: string;
  trxref: string;
}

declare global {
  interface Window {
    PaystackPop: {
      new (): {
        newTransaction: (config: {
          key: string;
          email: string;
          amount: number;
          reference?: string;
          metadata?: {
            planId: string;
            locationId: string;
            userId: string;
          };
          onSuccess: (transaction: PaystackTransaction) => void;
          onCancel: () => void;
          onError?: (error: { message: string }) => void;
        }) => void;
      };
    };
  }
}

export function CheckoutDialog({ open, onOpenChange, plan, locationName, subaccountCode, tenantId }: CheckoutDialogProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [paystackLoaded, setPaystackLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset state when dialog opens/closes
    if (!open) {
      setError(null);
      setProcessing(false);
    }
  }, [open]);

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
          tenantId: tenantId || "",
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Payment verification failed. Please contact support.");
        return;
      }

      onOpenChange(false);
      router.push(`/voucher?id=${data.data.voucherId}`);
    } catch (error) {
      console.error("Error verifying payment:", error);
      setError("An error occurred while verifying your payment. Please contact support.");
    } finally {
      setProcessing(false);
    }
  };

  const handlePay = () => {
    if (!plan || !user || !paystackLoaded) return;

    setError(null);

    const reference = generateReference(user.uid);

    try {
      const popup = new window.PaystackPop();

      const config: any = {
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: user.email!,
        amount: plan.price,
        reference: reference,
        metadata: {
          planId: plan.id,
          locationId: plan.locationId,
          userId: user.uid,
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

      // Add subaccount split if provided (for tenant payments)
      if (subaccountCode) {
        config.subaccount = subaccountCode;
        config.bearer = "subaccount"; // Tenant bears Paystack fees
      }

      popup.newTransaction(config);
    } catch (error) {
      console.error("Error initializing payment:", error);
      setError("Failed to initialize payment. Please try again.");
    }
  };

  if (!plan) return null;

  return (
    <>
      <Script
        src="https://js.paystack.co/v2/inline.js"
        onLoad={() => setPaystackLoaded(true)}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
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
                  <div className="border-t pt-2 mt-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold">Total:</span>
                      <span className="text-xl font-bold">
                        ₦{(plan.price / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handlePay}
                  disabled={!paystackLoaded || processing}
                >
                  {!paystackLoaded ? "Loading..." : `Pay ₦${(plan.price / 100).toFixed(2)}`}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => onOpenChange(false)}
                  disabled={processing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
