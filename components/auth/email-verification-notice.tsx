"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/providers/auth-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
 * Which makes this notice the entire mechanism. It only renders for a signed
 * in account, which is the first moment there is anything to act on, and it
 * carries both ways out: send the link, or fix the address if it is wrong.
 * A notice without that second route is a dead end - telling someone their
 * address is unreachable and offering no way to correct it.
 */
export function EmailVerificationNotice({
  settingsHref,
  audience,
}: {
  /** Where the address can actually be changed. */
  settingsHref: string;
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
      <TriangleAlert className="size-4" />
      <AlertTitle>Confirm your email address</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {audience === "owner"
            ? `We haven't confirmed ${user.email} yet. Sales summaries and alerts about failed sales or an offline router all go there, so it is worth knowing it works.`
            : `We haven't confirmed ${user.email} yet. Your voucher details are emailed there, so it is worth knowing it works.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={send} disabled={sending || sent}>
            {sending ? "Sending..." : sent ? "Link sent" : "Send me a link"}
          </Button>
          <Link
            href={settingsHref}
            className="text-sm underline underline-offset-3 hover:text-foreground"
          >
            Wrong address?
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  );
}
