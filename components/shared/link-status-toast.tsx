"use client";

import { useEffect } from "react";
import { toast } from "@/components/ui/toast";

/**
 * Says how "Verify your account" went, once, when the customer lands back
 * here from the business's verification page with `?link=<status>`
 * (app/api/hooks/link/callback). The parameter is then removed, so a
 * refresh or a shared link does not say it again.
 */
const MESSAGES: Record<string, { title: string; type: "success" | "error" }> = {
  linked: { title: "You're verified. You can buy now.", type: "success" },
  expired: { title: "That verification took too long. Please try again.", type: "error" },
  used: { title: "That verification was already used. Please try again.", type: "error" },
  invalid: { title: "We couldn't verify you. Please try again.", type: "error" },
  signed_out: { title: "Sign in, then try verifying again.", type: "error" },
  busy: { title: "Too many attempts. Wait a minute and try again.", type: "error" },
  unavailable: { title: "Verification isn't available right now.", type: "error" },
  failed: { title: "Verification didn't work. Please try again.", type: "error" },
};

export function LinkStatusToast() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get("link");
    if (!status) return;
    const message = MESSAGES[status] ?? MESSAGES.failed;
    toast.add({ title: message.title, type: message.type });
    url.searchParams.delete("link");
    window.history.replaceState(window.history.state, "", url.toString());
  }, []);

  return null;
}
