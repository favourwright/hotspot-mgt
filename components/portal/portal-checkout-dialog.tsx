"use client";

import { useEffect, useRef, useState } from "react";
import { LogIn, TriangleAlert, Wifi } from "lucide-react";

import { usePaystackInline } from "@/hooks/use-paystack";
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
import { CopyButton } from "@/components/shared/copy-button";
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
  tenantId: string;
  tenantSlug: string;
  /**
   * Server-computed, in kobo, fee passthrough already applied. For display:
   * the charge itself is created by /api/purchase/initiate.
   */
  amount: number;
  /** Paystack's popup, or Knomad Pay's hosted checkout shown in a frame here. */
  gateway?: "paystack" | "knomadpay";
}

interface IssuedVoucher {
  username?: string;
  password?: string;
  /** The router user couldn't be created; an admin has to finish it. */
  pending: boolean;
  /** The server already logged this device in over the tunnel. */
  online: boolean;
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
  tenantId,
  tenantSlug,
  amount,
  gateway = "paystack",
}: PortalCheckoutDialogProps) {
  const { user } = useAuth();
  const { loaded: paystackLoaded, resume } = usePaystackInline();
  // Knomad Pay needs no script of ours: its checkout is a page, shown in a frame.
  const payReady = gateway === "knomadpay" || paystackLoaded;
  // Knomad Pay's checkout, open in the frame below, and the reference it pays.
  const [hostedCheckout, setHostedCheckout] = useState<{ url: string; reference: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useErrorState("Checkout failed");
  // Set when the business's decision hook asks to verify this customer.
  const [linkHref, setLinkHref] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<IssuedVoucher | null>(null);
  const [options, setOptions] = useState<PurchaseOptionsView | null>(null);
  // Null until the buyer answers. Nothing is preselected: an automatic
  // decision here is what put three separate purchases onto one login.
  const [intent, setIntent] = useState<PurchaseIntent | null>(null);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const loginFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setProcessing(false);
      setVoucher(null);
      setHostedCheckout(null);
      setOptions(null);
      setIntent(null);
      setBlockedReason(null);
    }
  }, [open, setError]);

  // The availability check moved here from `handlePay`, because its answer
  // is no longer only a yes or no: it also says what a purchase would do to
  // the logins this buyer already holds, and that has to be on screen
  // *before* the Paystack popup rather than a moment after it opens.
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

  const verifyPayment = async (reference: string) => {
    if (!plan) return;

    setProcessing(true);
    setError(null);

    try {
      // Authenticated, so the voucher is attached to the buyer's account
      // and shows up in their voucher history like any other purchase.
      const token = await user?.getIdToken();
      const response = await fetch("/api/payment/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          reference,
          planId: plan.id,
          locationId: plan.locationId,
          tenantId,
          deviceMac: session.mac,
          deviceIp: session.ip,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(
          data.error ||
            "We couldn't confirm your payment. Keep this page open and contact the network's support."
        );
        return;
      }

      setVoucher({
        username: data.data.username,
        password: data.data.password,
        pending: !data.data.username,
        online: data.data.autoLogin === true,
      });
    } catch (err) {
      console.error("Error verifying portal payment:", err);
      // Deliberately not "payment failed": the charge may well have gone
      // through and only our confirmation call dropped.
      setError(
        "Your payment may have gone through but we couldn't confirm it. Don't pay again -- contact the network's support."
      );
    } finally {
      setProcessing(false);
    }
  };

  // The return page (app/portal/payment-return), loaded in the frame once the buyer has
  // paid, names the reference; from here it is the same verify as Paystack's onSuccess.
  // Only our own origin is listened to, and only for the reference this dialog started.
  useEffect(() => {
    if (!hostedCheckout) return;
    const ours = (() => {
      try {
        return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin;
      } catch {
        return null;
      }
    })();
    const onMessage = (event: MessageEvent) => {
      if (ours && event.origin !== ours) return;
      const data = event.data as { type?: string; reference?: string } | null;
      if (data?.type !== "knomad-pay:return" || data.reference !== hostedCheckout.reference) return;
      setHostedCheckout(null);
      void verifyPayment(data.reference);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // verifyPayment reads the current plan and session; the reference is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostedCheckout]);

  const handlePay = async () => {
    if (!plan || !payReady || !user) return;
    setError(null);

    // The maxCustomers gate was resolved when the dialog opened, and the
    // button is disabled while it stands - this is the belt to that
    // braces, so a stale render cannot start a charge we would refuse.
    if (blockedReason) {
      setError(blockedReason);
      return;
    }

    try {
      // The server starts the transaction and records what was agreed;
      // the popup can only pay that. See app/api/purchase/initiate.
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

      if (result.data.gateway === "knomadpay" && result.data.checkoutUrl) {
        setHostedCheckout({ url: result.data.checkoutUrl, reference: result.data.reference });
        return;
      }

      resume(result.data.accessCode, {
        onSuccess: (transaction) => verifyPayment(transaction.reference),
        onCancel: () => {},
        onError: (err) => {
          console.error("Paystack error:", err);
          setError(err.message || "Payment couldn't be started.");
        },
      });
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
          <DialogTitle>{voucher ? "You're all set" : plan.name}</DialogTitle>
          <DialogDescription>
            {voucher
              ? voucher.online
                ? "You're connected. Save these details to sign in again later."
                : "Save these details, then get online."
              : [
                  plan.duration,
                  `${plan.dataLimit || "Unlimited"} data`,
                  formatDeviceLimit(plan.sharedUsers),
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </DialogDescription>
        </DialogHeader>

        {voucher ? (
          <VoucherResult
            voucher={voucher}
            session={session}
            formRef={loginFormRef}
          />
        ) : processing ? (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="size-10 animate-spin rounded-full border-2 border-muted border-b-primary" />
            <p className="text-sm text-muted-foreground">
              Confirming your payment and creating your voucher...
            </p>
          </div>
        ) : hostedCheckout ? (
          <div className="space-y-3">
            <iframe
              src={hostedCheckout.url}
              title="Payment"
              allow="payment"
              className="h-[34rem] w-full rounded-md border"
            />
            <p className="text-xs text-muted-foreground">
              Payment page not showing?{" "}
              <a href={hostedCheckout.url} target="_top" className="underline">
                Open it full screen
              </a>
              . Once you have paid, you are connected either way.
            </p>
            <Button tone="raised" onClick={() => setHostedCheckout(null)}>
              Back
            </Button>
          </div>
        ) : (
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
                  !payReady ||
                  !user ||
                  checking ||
                  Boolean(blockedReason) ||
                  needsAnswer
                }
              >
                {checking
                  ? "Checking..."
                  : !payReady
                    ? "Loading..."
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

function VoucherResult({
  voucher,
  session,
  formRef,
}: {
  voucher: IssuedVoucher;
  session: PortalSession;
  formRef: React.RefObject<HTMLFormElement | null>;
}) {
  const [connecting, setConnecting] = useState(false);

  if (voucher.pending) {
    return (
      <Alert>
        <TriangleAlert className="size-4" />
        <AlertDescription>
          Your payment went through, but the network didn&apos;t finish
          setting up your voucher. The owner has been notified and it will be
          issued shortly -- you have not been charged twice.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-panel bg-sunken p-4">
        <CredentialRow label="Username" value={voucher.username!} />
        <CredentialRow label="Password" value={voucher.password!} />
      </div>

      <p className="text-xs text-muted-foreground">
        Write these down or screenshot them. You&apos;ll need them to sign
        back in on this or another device.
      </p>

      {voucher.online ? (
        // Already logged in server-side over the tunnel, so there is nothing
        // to submit -- but the credentials above still matter for signing
        // back in on this or another device.
        <Alert>
          <Wifi className="size-4" />
          <AlertDescription>
            You&apos;re online. Carry on browsing.
          </AlertDescription>
        </Alert>
      ) : session.linkLoginOnly ? (
        // A real form POST, not fetch: the router answers a good login with
        // a redirect the browser has to follow. See components/portal/
        // portal-login.tsx for why this is PAP rather than CHAP.
        <form
          ref={formRef}
          method="post"
          action={session.linkLoginOnly}
          onSubmit={() => setConnecting(true)}
        >
          {session.linkOrig && (
            <input type="hidden" name="dst" value={session.linkOrig} />
          )}
          <input type="hidden" name="username" value={voucher.username} />
          <input type="hidden" name="password" value={voucher.password} />
          <Button
            type="submit"
            tone="action"
            className="w-full"
            disabled={connecting}
          >
            <LogIn />
            {connecting ? "Connecting..." : "Get online"}
          </Button>
        </form>
      ) : (
        <Alert>
          <Wifi className="size-4" />
          <AlertDescription>
            Go back to the Wi-Fi sign-in screen and enter these details to get
            online.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function CredentialRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1">
        <code className="font-mono text-sm font-medium">{value}</code>
        <CopyButton value={value} />
      </span>
    </div>
  );
}
