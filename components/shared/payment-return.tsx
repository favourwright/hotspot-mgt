"use client";

/**
 * Finishing a payment once Monnify's checkout brings the payer back (lib/checkout-return.ts).
 *
 * The reference in the address is only where to look: what it bought is the server's
 * record, and the server asks Knomad Pay whether it was paid. So the page does what the
 * checkout dialog used to do after its popup:
 *
 *  - a voucher sale: /api/payment/verify, then the voucher. At the captive portal, with
 *    the router session the tab kept, the credentials and the way online; from the
 *    storefront, the voucher's own page.
 *  - a plan period or an addon: /api/admin/billing/charges/[reference], then back to
 *    settings or the addons page.
 *
 * Monnify can take a moment to settle a payment it has just taken, so a payment not seen
 * yet is asked about again for a while. If the page never finishes (closed, or on
 * another device), Knomad Pay's event and the reconcile cron finish it anyway, and
 * nothing here ever suggests paying again.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { useAuth } from "@/providers/auth-provider";
import { tenantHref } from "@/lib/tenant-url";
import { checkoutReturnFor, forgetCheckoutReturn } from "@/lib/checkout-return";
import { confirmBillingPayment } from "@/components/tenant/confirm-billing-payment";
import { VoucherResult, type IssuedVoucher } from "@/components/portal/voucher-result";
import type { PortalSession } from "@/lib/captive-portal";
import { formatDay } from "@/lib/utils";

const ATTEMPTS = 8;
const WAIT_MS = 3000;
const DONT_PAY_AGAIN =
  "If you were charged, there is no need to pay again: it will be finished within a few minutes, and you will get an email.";

type View =
  | { state: "working" }
  | { state: "voucher"; voucher: IssuedVoucher; session: PortalSession }
  | { state: "billing"; message: string; back: string }
  | { state: "error"; message: string };

export function PaymentReturn({
  tenantSlug,
  purpose,
  reference,
}: {
  tenantSlug: string;
  purpose: "voucher" | "billing";
  reference: string;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>({ state: "working" });
  const started = useRef(false);
  const loginFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (loading || !user || !reference || started.current) return;
    started.current = true;

    void (async () => {
      if (purpose === "billing") {
        const result = await confirmBillingPayment(user, reference, { attempts: ATTEMPTS, waitMs: WAIT_MS });
        if (!result.ok) {
          setView({ state: "error", message: result.error });
          return;
        }
        const ret = checkoutReturnFor(reference);
        forgetCheckoutReturn(reference);
        const back = tenantHref(tenantSlug, ret?.kind === "billing" && ret.back === "addons" ? "/admin/addons" : "/admin/settings");
        setView({
          state: "billing",
          message: result.paidThrough ? `Paid until ${formatDay(new Date(result.paidThrough))}.` : "Your payment is applied.",
          back,
        });
        setTimeout(() => router.replace(back), 2500);
        return;
      }

      const ret = checkoutReturnFor(reference);
      const portal = ret?.kind === "voucher" ? ret.portal : null;
      let lastError = "We couldn't confirm your payment yet.";
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        try {
          const token = await user.getIdToken();
          const response = await fetch("/api/payment/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              reference,
              // Only at the captive portal: what lets the router log this device in. Left
              // out otherwise; verify takes no empty value for them.
              ...(portal?.mac ? { deviceMac: portal.mac } : {}),
              ...(portal?.ip ? { deviceIp: portal.ip } : {}),
            }),
          });
          const data = await response.json();
          if (response.ok && data.success) {
            forgetCheckoutReturn(reference);
            if (portal) {
              // No credentials back means the router user is not made yet: the owner is
              // told, and the buyer is not charged twice (the result says so).
              setView({
                state: "voucher",
                session: portal,
                voucher: {
                  username: data.data.username,
                  password: data.data.password,
                  pending: !data.data.username,
                  online: data.data.autoLogin === true,
                },
              });
            } else {
              router.replace(tenantHref(tenantSlug, `/voucher?id=${data.data.voucherId}`));
            }
            return;
          }
          lastError = data.error || lastError;
          // In progress elsewhere (the event got there first) is not a failure to retry.
          if (data.inProgress) {
            setView({ state: "error", message: data.error });
            return;
          }
        } catch {
          // A network slip: asked again, as for a payment not seen yet.
        }
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
      }
      setView({ state: "error", message: `${lastError} ${DONT_PAY_AGAIN}` });
    })();
  }, [loading, user, reference, purpose, tenantSlug, router]);

  // Decided from what is on hand rather than in the effect: nothing to ask the server.
  const shown: View | { state: "signin" } = !reference
    ? { state: "error", message: "This page needs a payment reference." }
    : !loading && !user
      ? { state: "signin" }
      : view;

  return (
    <SurfaceCard className="w-full max-w-md">
      <SurfaceCardHeader>
        <SurfaceCardTitle>
          {shown.state === "voucher" ? "You're all set" : shown.state === "error" ? "Almost there" : "Payment received"}
        </SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        {shown.state === "working" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="size-10 animate-spin rounded-full border-2 border-muted border-b-primary" />
            <p className="text-sm text-muted-foreground">
              {purpose === "billing" ? "Confirming your payment..." : "Confirming your payment and creating your voucher..."}
            </p>
          </div>
        )}
        {shown.state === "voucher" && <VoucherResult voucher={shown.voucher} session={shown.session} formRef={loginFormRef} />}
        {shown.state === "billing" && (
          <>
            <Alert>
              <CircleCheck className="size-4" />
              <AlertDescription>{shown.message} Taking you back...</AlertDescription>
            </Alert>
            <Button tone="raised" className="w-full" onClick={() => router.replace(shown.back)}>
              Back now
            </Button>
          </>
        )}
        {shown.state === "signin" && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertDescription>
              Sign in with the account you paid from to see this payment. {DONT_PAY_AGAIN}
            </AlertDescription>
          </Alert>
        )}
        {shown.state === "error" && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertDescription>{shown.message}</AlertDescription>
          </Alert>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
