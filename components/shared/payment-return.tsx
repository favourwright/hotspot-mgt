"use client";

/**
 * Finishing a payment once Monnify's checkout brings the payer back (lib/checkout-return.ts).
 * The payer comes back here whether they paid or not: leaving the checkout unpaid returns
 * here too.
 *
 * The reference in the address is only where to look: what it bought is the server's
 * record, and the server asks Knomad Pay whether it was paid. So the page does what the
 * checkout dialog used to do after its popup:
 *
 *  - a voucher sale: /api/payment/verify, then the voucher. At the captive portal, with
 *    the router session the tab kept, the credentials and the way online; from the
 *    storefront, the voucher's own page.
 *  - a plan period, an addon or credits: /api/admin/billing/charges/[reference], then
 *    back to settings, the addons page or Generate codes.
 *
 * Not finished, the server says how the payment stands (lib/payment-standing.ts), and the
 * page says that and nothing more: nothing claims a payment arrived before one has.
 * Monnify can take a moment to settle a payment it has just taken, so one that could
 * still change is asked about again for a while. "No need to pay again" is said only when
 * money moved or it could not be checked. Going back to an open checkout is the same
 * charge, so it can never be paid twice. If the page never finishes (closed, or on
 * another device), Knomad Pay's event and the reconcile cron finish it anyway.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Clock, TriangleAlert } from "lucide-react";
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
import {
  checkoutReturnFor,
  forgetCheckoutReturn,
  leaveForCheckout,
  type CheckoutReturn,
} from "@/lib/checkout-return";
import { portalHref, type PortalSession } from "@/lib/captive-portal";
import { UNKNOWN_STANDING, worthAskingAgain, type PaymentStanding } from "@/lib/payment-standing";
import { confirmBillingPayment } from "@/components/tenant/confirm-billing-payment";
import { VoucherResult, type IssuedVoucher } from "@/components/portal/voucher-result";
import { formatDay } from "@/lib/utils";

const ATTEMPTS = 8;
const WAIT_MS = 3000;

type Purpose = "voucher" | "billing";

type View =
  | { state: "working" }
  | { state: "voucher"; voucher: IssuedVoucher; session: PortalSession }
  | { state: "billing"; message: string; back: string }
  | { state: "standing"; standing: PaymentStanding }
  | { state: "error"; message: string };

/** What each standing says, for a voucher sale and for billing. */
function wordsForStanding(standing: PaymentStanding, purpose: Purpose): { title: string; body: string } {
  const voucher = purpose === "voucher";
  switch (standing.state) {
    case "awaiting_payment":
      return {
        title: "We haven't received your payment",
        body: voucher
          ? "If you didn't finish paying, you can pick up where you left off. If you paid by bank transfer, it can take a few minutes to arrive: we'll email your voucher as soon as it does."
          : "If you didn't finish paying, you can pick up where you left off. If you paid by bank transfer, it can take a few minutes to arrive, and it will be applied as soon as it does.",
      };
    case "not_paid":
      return standing.reason === "failed"
        ? { title: "Payment didn't go through", body: "Your payment wasn't completed. You can try again." }
        : { title: "Payment not completed", body: "This checkout closed before a payment arrived. You can start again." };
    case "received":
      return {
        title: "Payment received",
        body: voucher
          ? "We're finishing your order. There's no need to pay again: you'll get an email once your voucher is ready."
          : "We couldn't apply it automatically, so our team has been alerted and will sort it out. There's no need to pay again.",
      };
    case "unknown":
      return {
        title: "We couldn't check your payment",
        body: voucher
          ? "If you paid, there's no need to pay again: you'll get an email within a few minutes. If not, check again in a moment."
          : "If you paid, there's no need to pay again: it will show here within a few minutes. If not, check again in a moment.",
      };
  }
}

function billingBackPath(ret: CheckoutReturn | null, kind: string | null): string {
  // From the server's answer first, so a credits purchase finished on another tab or
  // device still lands on its own page.
  if (kind === "credits" || (ret?.kind === "billing" && ret.back === "generate")) return "/admin/generate";
  if (ret?.kind === "billing" && ret.back === "addons") return "/admin/addons";
  return "/admin/settings";
}

/** Where "try again" starts a new payment: wherever this one was started from. */
function startOverHref(tenantSlug: string, purpose: Purpose, ret: CheckoutReturn | null): string {
  if (purpose === "billing") return tenantHref(tenantSlug, billingBackPath(ret, null));
  const portal = ret?.kind === "voucher" ? ret.portal : null;
  return portal ? portalHref(`/${tenantSlug}/portal/plans`, portal) : tenantHref(tenantSlug, "/");
}

export function PaymentReturn({
  tenantSlug,
  purpose,
  reference,
}: {
  tenantSlug: string;
  purpose: Purpose;
  reference: string;
}) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [view, setView] = useState<View>({ state: "working" });
  const started = useRef(false);
  const loginFormRef = useRef<HTMLFormElement>(null);

  const check = useCallback(async () => {
    if (!user) return;
    setView({ state: "working" });

    if (purpose === "billing") {
      const result = await confirmBillingPayment(user, reference, { attempts: ATTEMPTS, waitMs: WAIT_MS });
      if (!result.ok) {
        setView(
          "standing" in result
            ? { state: "standing", standing: result.standing }
            : { state: "error", message: result.error }
        );
        return;
      }
      const ret = checkoutReturnFor(reference);
      forgetCheckoutReturn(reference);
      const back = tenantHref(tenantSlug, billingBackPath(ret, result.kind));
      setView({
        state: "billing",
        message: result.credits
          ? `${result.credits} credits added.`
          : result.paidThrough
            ? `Paid until ${formatDay(new Date(result.paidThrough))}.`
            : "Your payment is applied.",
        back,
      });
      setTimeout(() => router.replace(back), 2500);
      return;
    }

    const ret = checkoutReturnFor(reference);
    const portal = ret?.kind === "voucher" ? ret.portal : null;
    let standing: PaymentStanding = UNKNOWN_STANDING;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
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
        standing = (data.standing as PaymentStanding | undefined) ?? UNKNOWN_STANDING;
        if (!worthAskingAgain(standing)) break;
      } catch {
        // A network slip: asked again, and unknown if it never clears.
        standing = UNKNOWN_STANDING;
      }
    }
    setView({ state: "standing", standing });
  }, [user, reference, purpose, tenantSlug, router]);

  useEffect(() => {
    if (loading || !user || !reference || started.current) return;
    started.current = true;
    void check();
  }, [loading, user, reference, check]);

  // Decided from what is on hand rather than in the effect: nothing to ask the server.
  const shown: View | { state: "signin" } = !reference
    ? { state: "error", message: "This page needs a payment reference." }
    : !loading && !user
      ? { state: "signin" }
      : view;

  const standing = shown.state === "standing" ? shown.standing : null;
  const words = standing ? wordsForStanding(standing, purpose) : null;
  const resumeUrl = standing?.state === "awaiting_payment" ? standing.checkoutUrl : null;
  const title =
    shown.state === "voucher"
      ? "You're all set"
      : shown.state === "billing"
        ? "Payment received"
        : words
          ? words.title
          : shown.state === "error"
            ? "Something went wrong"
            : shown.state === "signin"
              ? "Sign in to continue"
              : "Checking your payment";

  const continuePayment = (checkoutUrl: string) => {
    // The same charge again, with whatever the tab kept for the way back.
    const ret: CheckoutReturn =
      checkoutReturnFor(reference) ??
      (purpose === "voucher" ? { kind: "voucher", portal: null } : { kind: "billing", back: "settings" });
    leaveForCheckout(checkoutUrl, reference, ret);
  };

  const startOver = () => {
    const ret = checkoutReturnFor(reference);
    forgetCheckoutReturn(reference);
    router.replace(startOverHref(tenantSlug, purpose, ret));
  };

  return (
    <SurfaceCard className="w-full max-w-md">
      <SurfaceCardHeader>
        <SurfaceCardTitle>{title}</SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        {shown.state === "working" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="size-10 animate-spin rounded-full border-2 border-muted border-b-primary" />
            <p className="text-sm text-muted-foreground">This takes a few seconds...</p>
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
        {standing && words && (
          <>
            <Alert>
              {standing.state === "received" ? <Clock className="size-4" /> : <TriangleAlert className="size-4" />}
              <AlertDescription>{words.body}</AlertDescription>
            </Alert>
            {resumeUrl && (
              <Button tone="action" className="w-full" onClick={() => continuePayment(resumeUrl)}>
                Continue payment
              </Button>
            )}
            {standing.state === "not_paid" && (
              <Button tone="action" className="w-full" onClick={startOver}>
                Try again
              </Button>
            )}
            {worthAskingAgain(standing) && (
              <Button tone="raised" className="w-full" onClick={() => void check()}>
                Check again
              </Button>
            )}
          </>
        )}
        {shown.state === "signin" && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertDescription>
              Sign in with the account you paid from to see this payment. If you paid, there&apos;s no need to pay
              again.
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
