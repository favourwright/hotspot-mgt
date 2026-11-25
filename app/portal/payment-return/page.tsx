"use client";

/**
 * Where Monnify's checkout sends the buyer once they have paid a Knomad Pay charge
 * (lib/knomad-pay.ts, paymentReturnUrl). Under /portal, a reserved slug.
 *
 * Shown inside the portal dialog's frame, it tells the dialog which reference was paid,
 * and the dialog verifies it as it would a Paystack popup's success. Opened on its own
 * (the "full screen" link), there is no dialog to tell: the payment is fulfilled and
 * this device logged in by Knomad Pay's event and the reconcile cron, from what the
 * checkout recorded, so it only says so. Nothing here is trusted: the reference only
 * starts a verify, which asks the gateway.
 *
 * `for=billing` marks a payment to the platform (a plan period or an addon, from a
 * tenant's dashboard), which is applied the same way and only worded differently.
 */
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function PaymentReturn() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? "";
  const billing = params.get("for") === "billing";

  // Tells the portal dialog around this frame which reference was paid. Opened on its
  // own there is no dialog, and the message goes nowhere; the wording below suits both.
  useEffect(() => {
    if (window.parent !== window && reference) {
      window.parent.postMessage({ type: "knomad-pay:return", reference }, "*");
    }
  }, [reference]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-b-primary" />
      <h1 className="text-lg font-semibold">Payment received</h1>
      {billing ? (
        <p className="max-w-sm text-sm text-muted-foreground">
          Finishing up: your dashboard will show it in a moment. If you opened this page on
          its own, you can close it and go back to your dashboard.
        </p>
      ) : (
        <p className="max-w-sm text-sm text-muted-foreground">
          Finishing up: you will be connected in a moment. Your voucher is also in your account,
          under your vouchers, if you need to sign in again later.
        </p>
      )}
    </main>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={null}>
      <PaymentReturn />
    </Suspense>
  );
}
