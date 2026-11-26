"use client";

import { useState } from "react";
import { LogIn, TriangleAlert, Wifi } from "lucide-react";
import { Button } from "@/components/system/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CopyButton } from "@/components/shared/copy-button";
import type { PortalSession } from "@/lib/captive-portal";

/**
 * A voucher just bought, as /api/payment/verify answers: its credentials, and at the
 * captive portal the way online (already logged in over the tunnel, or a login form
 * posted to the router). Shown on the return page once checkout comes back
 * (app/[tenantSlug]/payment-return).
 */
export interface IssuedVoucher {
  username?: string;
  password?: string;
  /** The router user couldn't be created; an admin has to finish it. */
  pending: boolean;
  /** The server already logged this device in over the tunnel. */
  online: boolean;
}

export function VoucherResult({
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
