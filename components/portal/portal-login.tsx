"use client";

import { useState } from "react";
import { LogIn, TriangleAlert } from "lucide-react";

import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PortalSession } from "@/lib/captive-portal";

interface PortalLoginProps {
  session: PortalSession;
}

/**
 * Voucher sign-in against the router.
 *
 * A real form POST, not `fetch`: the router answers a successful login with
 * a redirect to the originally requested page, which the browser has to
 * follow. An XHR would swallow that and leave the client online but staring
 * at our page.
 *
 * PAP (plain credentials) rather than CHAP. CHAP's challenge is minted when
 * the router renders its own page and goes stale while someone is off
 * paying, which is the common path here. These are single-use, expiring
 * vouchers rather than reusable passwords -- and the longer-term plan is to
 * stop sending credentials from the client at all, logging the MAC in from
 * the server over the tunnel once a purchase completes.
 */
export function PortalLogin({ session }: PortalLoginProps) {
  const [submitting, setSubmitting] = useState(false);

  if (!session.linkLoginOnly) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Connect to the network first</SurfaceCardTitle>
          <SurfaceCardDescription>
            Open this page from the Wi-Fi sign-in screen so we know which
            network to connect you to.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Have a voucher?</SurfaceCardTitle>
        <SurfaceCardDescription>
          Enter the username and password from your voucher to get online.
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        {session.error && (
          <Alert variant="destructive" className="mb-4">
            <TriangleAlert className="size-4" />
            <AlertDescription>{session.error}</AlertDescription>
          </Alert>
        )}

        <form
          method="post"
          action={session.linkLoginOnly}
          onSubmit={() => setSubmitting(true)}
          className="space-y-4"
        >
          {/* Where the router sends the client once login succeeds. */}
          {session.linkOrig && (
            <input type="hidden" name="dst" value={session.linkOrig} />
          )}

          <div className="space-y-2">
            <Label htmlFor="portal-username">Username</Label>
            <Input
              id="portal-username"
              name="username"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="HS-XXXXXXXX"
              required
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portal-password">Password</Label>
            <Input
              id="portal-password"
              name="password"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              disabled={submitting}
            />
          </div>

          <Button
            type="submit"
            tone="action"
            className="w-full"
            disabled={submitting}
          >
            <LogIn />
            {submitting ? "Connecting..." : "Get online"}
          </Button>
        </form>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
