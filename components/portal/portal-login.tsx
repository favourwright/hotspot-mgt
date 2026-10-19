"use client";

import { useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { portalHref, type PortalSession } from "@/lib/captive-portal";
import { friendlyPortalError } from "@/lib/hotspot-errors";

interface PortalLoginProps {
  session: PortalSession;
  /** Needed to build the link to the plan list, which is its own route. */
  tenantSlug: string;
  /**
   * The tenant's `portalMacNotice` switch. Off for everyone until an owner
   * turns it on - see components/tenant/portal-settings.tsx.
   */
  showMacNotice: boolean;
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
 * the server over the tunnel once a purchase completes. The router has to
 * be told to accept it: install-portal adds `http-pap` to the hotspot
 * server profile's `login-by` (lib/mikrotik.ts).
 *
 * Submitted as a top-level navigation rather than as a form POST. This page
 * is HTTPS and the router's login endpoint is plain HTTP on a LAN address
 * it can hold no certificate for, which makes a POST a *mixed form
 * submission* - Chrome blocks those outright, so the button appeared to do
 * nothing at all. A navigation to an http: URL is not mixed content, and
 * RouterOS accepts the same credentials as query parameters. The plain
 * `<form>` stays underneath for the no-JavaScript case.
 */
export function PortalLogin({
  session,
  tenantSlug,
  showMacNotice,
}: PortalLoginProps) {
  const [submitting, setSubmitting] = useState(false);

  // Whatever RouterOS said, turned into something the customer can act on.
  // Null when the attempt did not fail, so nothing renders on a first visit.
  const failure = friendlyPortalError(session.error);

  /**
   * Hands the credentials to the router as a navigation.
   *
   * Returning without preventing the default lets the plain form POST
   * through, which is the right fallback when there is no `linkLoginOnly`
   * to build a URL from.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    setSubmitting(true);
    if (!session.linkLoginOnly) return;

    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const url = new URL(session.linkLoginOnly);
    url.searchParams.set("username", String(form.get("username") ?? ""));
    url.searchParams.set("password", String(form.get("password") ?? ""));
    if (session.linkOrig) url.searchParams.set("dst", session.linkOrig);

    // `assign`, not `replace`: a failed login bounces back to the router's
    // own error page, and Back has to return here rather than to whatever
    // the client was originally trying to reach.
    window.location.assign(url.toString());
  }

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
        {failure && (
          /*
           * Inline and persistent, deliberately not a toast. This is a form
           * error the customer has to act on - re-reading their voucher,
           * or deciding to buy - and a toast that fades after a few seconds
           * takes the instructions away mid-read, cannot be returned to, and
           * sits far from the fields it is about. Toasts are for confirming
           * something that already worked; an error that blocks the task
           * belongs next to the task.
           */
          <Alert variant="destructive" className="mb-4">
            <TriangleAlert className="size-4" />
            <AlertTitle>{failure.title}</AlertTitle>
            <AlertDescription>
              <p>{failure.body}</p>
              {failure.offerPlans && (
                /*
                 * Only when buying is actually the way out. A customer whose
                 * voucher expired needs this; one whose network is full would
                 * be sold a plan that cannot connect them either.
                 *
                 * A route now, not the `#portal-plans` anchor this used to
                 * be: the plan list is its own page. An anchor to an id that
                 * no longer exists scrolls nowhere and reads as a dead
                 * button, on the alert shown to the customers most likely to
                 * buy. The session has to ride along - see portalHref.
                 */
                <p className="mt-2">
                  <Link
                    href={portalHref(`/${tenantSlug}/portal/plans`, session)}
                    className="underline underline-offset-4"
                  >
                    See the plans
                  </Link>
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <form
          method="post"
          action={session.linkLoginOnly}
          onSubmit={handleSubmit}
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
              autoCapitalize="none"
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
              autoCapitalize="none"
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
            {submitting ? "Connecting..." : "Connect"}
          </Button>
        </form>

        {showMacNotice && (
          /*
           * Under the form, muted, and deliberately not an Alert. The error
           * above is an Alert, and two stacked on a phone inside the captive
           * browser push the fields themselves below the fold - which is the
           * exact "this portal is slow" feeling the split exists to remove.
           *
           * The wording is ours rather than the one tenants carried over
           * from their old portals, which said a private address "may stop
           * you from logging in". It does not: sign-in here is a username
           * and password posted to the router and a rotating address does
           * not block it. What it really breaks is being recognised between
           * visits, and a plan's device count. A notice that predicts a
           * failure the customer then does not hit generates the support
           * calls it was meant to prevent.
           */
          <p className="mt-4 text-xs text-muted-foreground">
            Using a private or random Wi-Fi address can make this network see
            your phone as a new device each time. If you have trouble
            connecting or staying online, turn it off for this network in your
            Wi-Fi settings.
          </p>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
