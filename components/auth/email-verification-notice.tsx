"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/system/button";
import { toast } from "@/components/ui/toast";

/**
 * The only consequence of not confirming an email address.
 *
 * Nothing is blocked anywhere: a customer buys vouchers and connects, an
 * owner finishes onboarding and runs a portal, confirmed or not. That is a
 * deliberate product decision, not an oversight - a customer registers from
 * behind the captive portal's paywall, where their inbox is unreachable, so
 * any gate on reading an email would simply end the purchase.
 *
 * Which makes this notice the entire mechanism, and the reason it is kept
 * small. It is a standing condition rather than an event: it will sit on the
 * page every visit until acted on, so it has to earn its place at a glance
 * and then stay out of the way. One line, one button.
 *
 * ## One action, deliberately
 *
 * It used to carry a second link to the page where the address can be
 * changed. Two actions turned a one-line notice into a decision, and the
 * change route is already where the person ends up anyway: the account page
 * is in the nav, and this notice renders there too, directly above the card
 * that offers it. Somebody who knows the address is wrong does not need a
 * banner to tell them where to go; somebody who does not needs one button,
 * not two.
 *
 * ## Where it renders
 *
 * Mounted once per audience, never per page: `TenantNav` for customers and
 * the tenant admin layout for owners. Dropping it into individual pages is
 * how it ended up in two places and missing from several others.
 */
export function EmailVerificationNotice({
  audience,
}: {
  audience: "customer" | "owner";
}) {
  const { user, loading } = useAuth();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Nothing during the auth handshake: a notice that flashes up and vanishes
  // on every page load reads as a glitch, and this one is not urgent enough
  // to earn that.
  if (loading || !user || user.emailVerified) return null;

  async function send() {
    setSending(true);
    try {
      const token = await user!.getIdToken();
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      setSent(true);
      toast.add({
        title: data.data?.alreadyVerified
          ? "Already confirmed"
          : "Check your inbox",
        description: data.data?.alreadyVerified
          ? "Reload the page to clear this notice."
          : `We sent a link to ${user!.email}.`,
        type: "success",
      });
    } catch (error) {
      toast.add({
        title: "Couldn't send that",
        description:
          error instanceof Error ? error.message : "Try again shortly.",
        type: "error",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Alert>
      <MailWarning className="size-4" />
      <AlertTitle>Confirm your email address</AlertTitle>
      <AlertDescription>
        {audience === "owner"
          ? `Your sales summaries and alerts go to ${user.email}.`
          : `Your voucher details are sent to ${user.email}.`}
      </AlertDescription>
      {/* The system's slot for a single action: pinned top right, clear of
          the text, which is why the copy above stays one line. */}
      <AlertAction>
        <Button scale="sm" onClick={send} disabled={sending || sent}>
          {sending ? "Sending..." : sent ? "Sent" : "Confirm"}
        </Button>
      </AlertAction>
    </Alert>
  );
}
