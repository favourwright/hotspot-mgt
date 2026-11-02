"use client";

import { useErrorState } from "@/components/system/use-error-state";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signInWithEmailAndPassword } from "@firebase/auth";
import { auth } from "@/lib/firebase";
import { fetchAccountSummary } from "@/lib/account-client";
import { beginSignIn, establishSession } from "@/lib/session-client";
import { normalizeRole } from "@/lib/auth-claims";
import { goToPostLoginDestination } from "@/lib/post-login-destination";
import { safeRedirect } from "@/lib/safe-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
  /** Hands the typed email over so the reset form opens prefilled. */
  onForgotPassword?: (email: string) => void;
}

export function LoginForm({
  onSuccess,
  onSwitchToRegister,
  onForgotPassword,
}: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useErrorState("Sign in failed");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!auth) {
      setError("Authentication not initialized");
      setLoading(false);
      return;
    }

    // Marks the gap between Firebase creating the credential and the cookie
    // existing. `onIdTokenChanged` fires inside it, and without this the
    // reconciliation there would see a signed-in browser with no session
    // and sign the user out of the sign-in they are in the middle of.
    const signInDone = beginSignIn();

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Mint the server-readable session cookie so admin/superadmin pages
      // can verify this login server-side, not just in client state. This
      // comes before the role lookup: the cookie is what actually gates the
      // app, so it must not depend on a lookup that can fail.
      const tokenResult = await userCredential.user.getIdTokenResult();
      await establishSession(tokenResult.token);

      // Idempotent, and deliberately not awaited for its result: it re-syncs
      // custom claims for accounts that predate them and reconciles our
      // copies of the email address after a change committed elsewhere. It
      // creates nothing and sends no welcome mail on this path - that branch
      // only runs when the user document did not already exist. A failure
      // here must never block a sign-in that has already succeeded.
      fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResult.token}`,
        },
        body: JSON.stringify({
          uid: userCredential.user.uid,
          email: userCredential.user.email ?? email,
        }),
      }).catch((error) => console.error("Post-login sync failed:", error));

      // The role is only a redirect hint - every page re-checks it on the
      // server. Claims carry it for free; older accounts need one read.
      let userRole = normalizeRole(tokenResult.claims.role);
      if (!userRole) {
        try {
          const account = await fetchAccountSummary(tokenResult.token);
          userRole = account?.role ?? "customer";
        } catch (lookupError) {
          console.error("Role lookup failed, defaulting to customer:", lookupError);
          userRole = "customer";
        }
      }

      if (onSuccess) {
        onSuccess();
      } else {
      // A `?next=` set by the captive portal (or any page that needed a
      // sign-in first) wins over the role-based destination. Validated, not
      // trusted: an unchecked value here is an open redirect off the back of
      // our own sign-in page. See lib/safe-redirect.ts.
      const next = safeRedirect(searchParams.get("next"));
      if (next) {
        // A full page load, not router.push: `next` can point at a different
        // tenant subdomain, and a client-side navigation across origins does
        // not reliably do anything at all.
        window.location.assign(next);
        return;
      }

        // Shared with the gate on `/auth`, which bounces an
        // already-signed-in visitor to the same place this sends them.
        // One function so "where you would have landed" stays one answer.
        await goToPostLoginDestination(router, {
          role: userRole,
        });
      }
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setError("Invalid email or password");
      } else if (err.code === "auth/invalid-credential") {
        setError("Invalid email or password");
      } else {
        setError("Failed to login. Please try again.");
      }
    } finally {
      signInDone();
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          placeholder="m@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">Password</Label>
          {onForgotPassword && (
            <button
              type="button"
              onClick={() => onForgotPassword(email)}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot password?
            </button>
          )}
        </div>
        <Input
          id="login-password"
          type="password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Logging in..." : "Login"}
      </Button>
    </form>
  );
}
