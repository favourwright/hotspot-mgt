"use client";

import { useErrorState } from "@/components/system/use-error-state";
import { useState } from "react";
import { sendPasswordResetEmail } from "@firebase/auth";
import { ArrowLeft, MailCheck } from "lucide-react";

import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ForgotPasswordFormProps {
  /** Prefills from whatever was already typed into the login form. */
  initialEmail?: string;
  onBackToLogin: () => void;
}

export function ForgotPasswordForm({
  initialEmail = "",
  onBackToLogin,
}: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useErrorState("Couldn't send reset link");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  // Only reached when our route could not be used at all. Same behaviour as
  // before the route existed, including the enumeration rule below.
  const firebaseFallback = async () => {
    if (!auth) {
      setError("Authentication not initialized");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setSent(true);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-email") {
        setError("That doesn't look like a valid email address.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else {
        // Anything else -- including `auth/user-not-found` -- reports
        // success. Telling a stranger whether an address has an account
        // here turns this form into an account-enumeration oracle.
        console.error("Password reset error:", err);
        setSent(true);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Ours first: our email, our landing page. The route answers the same
      // whether or not the address has an account, and falls back to
      // Firebase's own email itself when ours cannot go.
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setSent(true);
        return;
      }
      if (response.status === 400 || response.status === 429) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Couldn't send reset link");
        return;
      }
      // Any other status means the route itself broke, so fall through to
      // the browser's own Firebase call, which is how this always worked.
      throw new Error(`password-reset route responded ${response.status}`);
    } catch (routeError) {
      console.error("Password reset route failed, using Firebase:", routeError);
      await firebaseFallback();
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-10 place-items-center rounded-lg bg-sunken">
            <MailCheck className="size-5" />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              If an account exists for{" "}
              <span className="font-medium text-foreground">{email}</span>,
              we&apos;ve sent a link to reset its password. The link expires in
              an hour.
            </p>
          </div>
        </div>

        <div className="flex gap-2 max-md:flex-col">
          <Button type="button" variant="ghost" onClick={onBackToLogin}>
            <ArrowLeft />
            Back to login
          </Button>
          <Button
            type="button"
            variant="outline"
            className="md:flex-1"
            onClick={() => setSent(false)}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        Enter the email you signed up with and we&apos;ll send you a link to
        set a new password.
      </p>

      <div className="space-y-2">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          placeholder="m@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <div className="flex max-md:flex-col gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onBackToLogin}
          disabled={loading}
        >
          <ArrowLeft />
          Back to login
        </Button>
        <Button type="submit" className="md:flex-1" disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </div>
    </form>
  );
}
