"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from "@firebase/auth";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { auth } from "@/lib/firebase";
import { safeRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

/**
 * Handles every Firebase email action link.
 *
 * **Every** is load-bearing. Pointing a template at this page takes Firebase's
 * own handler out of the loop for that template, and the one already in
 * production is password reset (`forgot-password-form.tsx`). A handler that
 * only knew about email verification would leave resets landing on a page
 * that shrugged - the email still sending, the link still valid, and nobody
 * able to finish. So `resetPassword` is implemented here in full, new-password
 * form and all, and anything unrecognised says so plainly instead of
 * rendering nothing.
 *
 * `recoverEmail` matters for the same reason and is easier to miss: Firebase
 * sends it to the OLD address when an email changes, and it is the only way
 * back if a change was not the owner's doing.
 */

type Phase =
  | { kind: "working" }
  | { kind: "password"; email: string }
  | { kind: "done"; title: string; body: string; continueUrl: string | null }
  | { kind: "error"; title: string; body: string };

/** Copy per mode, so the success screen says what actually happened. */
const DONE_COPY: Record<string, { title: string; body: string }> = {
  verifyEmail: {
    title: "Email confirmed",
    body: "Thanks - we know we can reach you at this address now.",
  },
  verifyAndChangeEmail: {
    title: "Email address updated",
    body: "Your account now uses this address. Sign in with it from now on.",
  },
  recoverEmail: {
    title: "Email change reversed",
    body: "Your account is back on its previous address. If you did not request that change, change your password now.",
  },
};

export function AuthAction() {
  const params = useSearchParams();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const mode = params.get("mode");
  const oobCode = params.get("oobCode");

  // The router hands this to us in a query string, and it ends up in a
  // navigation, so it is validated rather than trusted - the same gadget
  // lib/safe-redirect.ts exists to close on the sign-in page.
  const continueUrl = safeRedirect(params.get("continueUrl"));

  useEffect(() => {
    if (!auth) {
      setPhase({
        kind: "error",
        title: "Something went wrong",
        body: "We could not start up properly. Reload the page and try again.",
      });
      return;
    }

    if (!mode || !oobCode) {
      setPhase({
        kind: "error",
        title: "This link is incomplete",
        body: "Open the link from your email again, or ask for a new one.",
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        if (mode === "resetPassword") {
          // Resolves the account the code belongs to, and fails here rather
          // than after they have typed a new password twice.
          const email = await verifyPasswordResetCode(auth!, oobCode);
          if (!cancelled) setPhase({ kind: "password", email });
          return;
        }

        if (
          mode === "verifyEmail" ||
          mode === "verifyAndChangeEmail" ||
          mode === "recoverEmail"
        ) {
          // Inspected before being spent: an expired code should produce
          // "ask for another" rather than a raw failure, and applying it is
          // one-way.
          await checkActionCode(auth!, oobCode);
          await applyActionCode(auth!, oobCode);

          // Our own copies of the address follow Firebase's. Best effort and
          // only when signed in on this device - the authoritative catch-up
          // runs on the next sign-in (app/api/auth/register).
          await syncEmail();

          if (!cancelled) {
            setPhase({ kind: "done", ...DONE_COPY[mode], continueUrl });
          }
          return;
        }

        setPhase({
          kind: "error",
          title: "We can't handle this link",
          body: "It may be from a newer version of the app. Ask for a fresh link and try again.",
        });
      } catch (error) {
        if (cancelled) return;
        setPhase({ kind: "error", ...describe(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
    // `continueUrl` is derived from params and stable for a given URL.
  }, [mode, oobCode, continueUrl]);

  const submitPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setFormError("");

      if (password.length < 6) {
        setFormError("Use at least 6 characters.");
        return;
      }
      if (password !== confirm) {
        setFormError("Those two passwords don't match.");
        return;
      }

      setSubmitting(true);
      try {
        await confirmPasswordReset(auth!, oobCode!, password);
        setPhase({
          kind: "done",
          title: "Password changed",
          body: "You can sign in with your new password now.",
          continueUrl,
        });
      } catch (error) {
        const described = describe(error);
        setFormError(described.body);
      } finally {
        setSubmitting(false);
      }
    },
    [password, confirm, oobCode, continueUrl]
  );

  if (phase.kind === "working") {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>One moment</SurfaceCardTitle>
          <SurfaceCardDescription>Checking your link...</SurfaceCardDescription>
        </SurfaceCardHeader>
      </SurfaceCard>
    );
  }

  if (phase.kind === "password") {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Choose a new password</SurfaceCardTitle>
          <SurfaceCardDescription>
            For {phase.email}.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          <form onSubmit={submitPassword} className="space-y-4">
            {formError && (
              <Alert variant="destructive">
                <TriangleAlert className="size-4" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <Button
              type="submit"
              tone="action"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? "Saving..." : "Save new password"}
            </Button>
          </form>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  const isDone = phase.kind === "done";

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-start gap-3">
          {isDone ? (
            <CircleCheck className="mt-0.5 size-5 text-primary" />
          ) : (
            <TriangleAlert className="mt-0.5 size-5 text-destructive" />
          )}
          <div className="space-y-1">
            <SurfaceCardTitle>{phase.title}</SurfaceCardTitle>
            <SurfaceCardDescription>{phase.body}</SurfaceCardDescription>
          </div>
        </div>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        <Button
          tone="action"
          className="w-full"
          onClick={() => {
            // `window.location`, not `router.push`: continueUrl can be a
            // different origin (a tenant subdomain), and a client-side
            // navigation across origins does not reliably do a full load.
            window.location.assign(
              (isDone && phase.continueUrl) || "/auth"
            );
          }}
        >
          {isDone && phase.continueUrl ? "Continue" : "Go to sign in"}
        </Button>
      </SurfaceCardContent>
    </SurfaceCard>
  );
}

/**
 * Tells the server to bring our copies of the address in line.
 *
 * Only possible when the person happens to be signed in on the device they
 * opened the email on. Silent when they are not - the reconcile also runs on
 * the next sign-in, which is the path that actually guarantees it.
 */
async function syncEmail(): Promise<void> {
  try {
    const user = auth?.currentUser;
    if (!user) return;
    // Forced refresh: the change just committed, so the cached token still
    // carries the old address.
    const token = await user.getIdToken(true);
    await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ uid: user.uid, email: user.email ?? "" }),
    });
  } catch (error) {
    console.error("Email sync after action failed:", error);
  }
}

/** Firebase error codes, as a sentence rather than a code. */
function describe(error: unknown): { title: string; body: string } {
  const code = (error as { code?: string })?.code ?? "";

  if (code.includes("expired-action-code")) {
    return {
      title: "This link has expired",
      body: "Links are only good for a short while. Ask for a new one and it will work.",
    };
  }
  if (code.includes("invalid-action-code")) {
    return {
      title: "This link has already been used",
      body: "Each link works once. If you still need to finish this, ask for a new one.",
    };
  }
  if (code.includes("user-disabled")) {
    return {
      title: "This account is disabled",
      body: "Get in touch with support and we'll sort it out.",
    };
  }
  if (code.includes("user-not-found")) {
    return {
      title: "We couldn't find that account",
      body: "It may have been removed. Get in touch with support if that's unexpected.",
    };
  }
  if (code.includes("weak-password")) {
    return {
      title: "Pick a stronger password",
      body: "Use at least 6 characters.",
    };
  }

  console.error("Auth action failed:", error);
  return {
    title: "Something went wrong",
    body: "We couldn't complete that. Ask for a new link and try again.",
  };
}
