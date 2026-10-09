"use client";

import { resolveOwnerTenantSlug } from "@/lib/owner-redirect";
import { pushTenantUrl } from "@/lib/tenant-url";
import { useErrorState } from "@/components/system/use-error-state";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { establishSession } from "@/lib/session-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RegisterFormProps {
  onSuccess?: () => void;
  onSwitchToLogin?: () => void;
}

export function RegisterForm({ onSuccess, onSwitchToLogin }: RegisterFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useErrorState("Sign up failed");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    if (!auth || !db) {
      setError("Authentication not initialized");
      setLoading(false);
      return;
    }

    try {
      // Step 1: Create Firebase Auth user first
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // Step 2: Get the ID token from the newly created user
      const idToken = await user.getIdToken();

      // Step 3: Call the API with the token and uid to create Firestore document
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid: user.uid, email }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to complete registration");
      }

      // Step 4: Get user role from response
      const userRole = data.data?.role || "customer";

      // Force a token refresh so onIdTokenChanged re-reads the Firestore user
      // doc this request just created - otherwise AuthProvider's listener
      // (which fired the instant Auth created the user, before this doc
      // existed) leaves userRole stuck at null for the rest of the session,
      // and no role guard (e.g. superadmin -> /superadmin, onboarding's
      // superadmin redirect) will ever match.
      const freshToken = await user.getIdToken(true);

      // Mint the server-readable session cookie so admin/superadmin pages
      // can verify this account server-side, not just in client state.
      await establishSession(freshToken);

      if (onSuccess) {
        onSuccess();
      } else {
        // Redirect based on role
        if (userRole === "superadmin") {
          router.push("/superadmin");
        } else if (userRole === "owner") {
          // Only reachable when an existing owner account re-registers --
          // a fresh sign-up has no tenant yet and falls through to `/`.
          const slug = await resolveOwnerTenantSlug(
            data.data?.tenantId ?? null,
            user.uid
          );
          if (slug) {
            pushTenantUrl(router, slug, "/admin");
          } else {
            router.push("/");
          }
        } else {
          // Customer - go to home
          router.push("/");
        }
      }
    } catch (err: any) {
      console.error("Registration error:", err);
      if (err.code === "auth/email-already-in-use") {
        setError("An account with this email already exists");
      } else if (err.code === "auth/invalid-email") {
        setError("Invalid email address");
      } else {
        setError(err.message || "Failed to register. Please try again.");
      }
    } finally {
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
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          type="email"
          placeholder="m@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-password">Password</Label>
        <Input
          id="register-password"
          type="password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={loading}
          minLength={6}
        />
        <p className="text-xs text-muted-foreground">
          Must be at least 6 characters
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-confirm-password">Confirm Password</Label>
        <Input
          id="register-confirm-password"
          type="password"
          placeholder="Re-enter your password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          disabled={loading}
        />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  );
}
