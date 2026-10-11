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
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Button } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CopyButton } from "@/components/shared/copy-button";
import { formatNaira } from "@/lib/utils";
import type { PortalSession } from "@/lib/captive-portal";
import type { Plan } from "@/types/schemas";

interface PortalCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: Plan | null;
  session: PortalSession;
  tenantId: string;
  tenantSlug: string;
  /** Server-computed, in kobo -- fee passthrough already applied. */
  amount: number;
  transactionCharge: number | null;
  subaccountCode: string | null;
  bearer: "account" | "subaccount";
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
 * The amount and split arrive as props, computed while the page rendered,
 * rather than from /api/tenant/[slug]/checkout-amount, and
 * /api/payment/verify recomputes the expected amount from the plan anyway
 * before it issues anything.
 */
export function PortalCheckoutDialog({
  open,
  onOpenChange,
  plan,
  session,
  tenantId,
  tenantSlug,
  amount,
  transactionCharge,
  subaccountCode,
  bearer,
}: PortalCheckoutDialogProps) {
  const { user } = useAuth();
  const { loaded: paystackLoaded, pay } = usePaystackInline();
  const [checking, setChecking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useErrorState("Checkout failed");
  const [voucher, setVoucher] = useState<IssuedVoucher | null>(null);
  const loginFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setProcessing(false);
      setVoucher(null);
    }
  }, [open, setError]);

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

  const handlePay = async () => {
    if (!plan || !paystackLoaded || !user) return;
    setError(null);

    // The same maxCustomers gate the signed-in storefront applies before its
    // popup opens. The portal page already shows a coarse block at render
    // time, but that is computed without knowing who is looking - only here,
    // with a token, can an existing customer be told apart from a new one.
    // Enforced before payment because /api/payment/verify never refuses
    // fulfilment once money has moved.
    setChecking(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tenant/${tenantSlug}/can-purchase`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError("We couldn't check availability. Please try again.");
        return;
      }
      if (!data.data.allowed) {
        setError(
          data.data.reason ||
            "This network isn't accepting new customers right now."
        );
        return;
      }
    } catch {
      setError("We couldn't check availability. Please try again.");
      return;
    } finally {
      setChecking(false);
    }

    const config: Record<string, unknown> = {
      key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
      email: user?.email ?? "",
      amount,
      reference: `hs_${Date.now()}_${(session.mac ?? "guest").replace(/[^a-zA-Z0-9]/g, "").slice(-8)}`,
      metadata: {
        planId: plan.id,
        locationId: plan.locationId,
        tenantId,
        deviceMac: session.mac,
        // Both carried so the `charge.success` webhook can fulfil this sale
        // without the browser. This is the flow where that matters most: the
        // buyer is behind the paywall and the bank's 3DS step navigates the
        // page away, which is exactly how a real payment once produced no
        // voucher, no record and no email.
        deviceIp: session.ip,
        userId: user?.uid,
      },
      onSuccess: (transaction: { reference: string }) =>
        verifyPayment(transaction.reference),
      onCancel: () => {},
      onError: (err: { message: string }) => {
        console.error("Paystack error:", err);
        setError(err.message || "Payment couldn't be started.");
      },
    };

    if (subaccountCode) {
      config.subaccount = subaccountCode;
      config.bearer = bearer;
      if (transactionCharge !== null) {
        config.transaction_charge = transactionCharge;
      }
    }

    try {
      pay(config);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Payment couldn't be started."
      );
    }
  };

  if (!plan) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{voucher ? "You're all set" : plan.name}</DialogTitle>
          <DialogDescription>
            {voucher
              ? voucher.online
                ? "You're connected. Save these details to sign in again later."
                : "Save these details, then get online."
              : `${plan.duration} · ${plan.dataLimit || "Unlimited"} data`}
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
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-panel bg-sunken p-3">
              <p className="text-xs text-muted-foreground">Billed to</p>
              <p className="text-sm font-medium">{user?.email}</p>
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <span className="text-sm font-semibold">Total</span>
              <span className="text-xl font-semibold tracking-tight">
                {formatNaira(amount)}
              </span>
            </div>

            <Button
              tone="accent"
              className="w-full"
              onClick={handlePay}
              disabled={!paystackLoaded || !user || checking}
            >
              {checking
                ? "Checking..."
                : paystackLoaded
                  ? `Pay ${formatNaira(amount)}`
                  : "Loading..."}
            </Button>
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
