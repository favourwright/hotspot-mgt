"use client";

/**
 * Knomad Pay's checkout (Monnify's hosted page, the gateway's `checkoutUrl`), shown in a
 * frame inside a checkout dialog, with a link to open it full screen instead. Used by
 * both buying paths: the storefront and the captive portal.
 *
 * Once the buyer has paid, Monnify sends the frame to /portal/payment-return, which
 * posts `{ type: "knomad-pay:return", reference }` to this window. Only our own origin is
 * listened to, and only for the reference this checkout started; the reference then goes
 * to the dialog's usual verify, which asks the gateway, so nothing in the message itself
 * is trusted.
 */
import { useEffect, useRef } from "react";
import { Button } from "@/components/system/button";

export interface HostedCheckoutState {
  url: string;
  reference: string;
}

export function HostedCheckout({
  checkout,
  onPaid,
  onBack,
}: {
  checkout: HostedCheckoutState;
  onPaid: (reference: string) => void;
  onBack: () => void;
}) {
  // The latest callback without re-subscribing on every render.
  const paid = useRef(onPaid);
  useEffect(() => {
    paid.current = onPaid;
  });

  useEffect(() => {
    let ours: string | null = null;
    try {
      ours = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
    } catch {
      ours = null;
    }
    const onMessage = (event: MessageEvent) => {
      if (ours && event.origin !== ours) return;
      const data = event.data as { type?: string; reference?: string } | null;
      if (data?.type !== "knomad-pay:return" || data.reference !== checkout.reference) return;
      paid.current(checkout.reference);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [checkout.reference]);

  return (
    <div className="space-y-3">
      <iframe src={checkout.url} title="Payment" allow="payment" className="h-[34rem] w-full rounded-md border" />
      <p className="text-xs text-muted-foreground">
        Payment page not showing?{" "}
        <a href={checkout.url} target="_top" className="underline">
          Open it full screen
        </a>
        . Once you have paid, your voucher comes either way.
      </p>
      <Button tone="raised" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
