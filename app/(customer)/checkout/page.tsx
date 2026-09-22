"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CheckoutPlan {
  planId: string;
  planName: string;
  locationId: string;
  locationName: string;
  price: number;
  duration: string;
  dataLimit?: string;
}

declare global {
  interface Window {
    PaystackPop: {
      setup: (config: {
        key: string;
        email: string;
        amount: number;
        ref: string;
        metadata: {
          planId: string;
          locationId: string;
          userId: string;
        };
        onSuccess: (transaction: { reference: string }) => void;
        onClose: () => void;
      }) => {
        openIframe: () => void;
      };
    };
  }
}

export default function CheckoutPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<CheckoutPlan | null>(null);
  const [paystackLoaded, setPaystackLoaded] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login?redirect=/checkout");
      return;
    }

    if (!user) return;

    const checkoutData = localStorage.getItem("checkoutPlan");
    if (!checkoutData) {
      router.push("/");
      return;
    }

    try {
      const parsedPlan = JSON.parse(checkoutData) as CheckoutPlan;
      setPlan(parsedPlan);
    } catch (error) {
      console.error("Error parsing checkout data:", error);
      router.push("/");
    }
  }, [user, authLoading, router]);

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
          planId: plan.planId,
          locationId: plan.locationId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || "Payment verification failed. Please contact support.");
        return;
      }

      localStorage.removeItem("checkoutPlan");
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

    setCancelled(false);
    setError(null);

    const reference = generateReference(user.uid);

    const handler = window.PaystackPop.setup({
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
      email: user.email!,
      amount: plan.price,
      ref: reference,
      metadata: {
        planId: plan.planId,
        locationId: plan.locationId,
        userId: user.uid,
      },
      onSuccess: (transaction) => handlePaymentSuccess(transaction.reference),
      onClose: () => {
        if (!processing) {
          setCancelled(true);
        }
      },
    });

    handler.openIframe();
  };

  if (authLoading || !plan) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="container mx-auto py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Verifying Payment</CardTitle>
            <CardDescription>
              Please wait while we verify your payment and generate your voucher...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://js.paystack.co/v1/inline.js"
        onLoad={() => setPaystackLoaded(true)}
      />

      <div className="container mx-auto py-8 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Checkout</CardTitle>
            <CardDescription>Review your order and proceed to payment</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Order Summary</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plan:</span>
                  <span className="font-medium">{plan.planName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location:</span>
                  <span className="font-medium">{plan.locationName}</span>
                </div>
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
                <div className="border-t pt-3 mt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-lg font-semibold">Total:</span>
                    <span className="text-2xl font-bold">
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

            {cancelled && (
              <Alert>
                <AlertDescription>
                  Payment was cancelled. Click the button below to try again.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
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
              onClick={() => router.push("/")}
              disabled={processing}
            >
              Cancel
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  );
}
