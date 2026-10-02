"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { establishSession } from "@/lib/session-client";
import { normalizeRole } from "@/lib/auth-claims";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface LoginFormProps {
  onSuccess?: () => void;
  onSwitchToRegister?: () => void;
}

export function LoginForm({ onSuccess, onSwitchToRegister }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    if (!auth || !db) {
      setError("Authentication not initialized");
      setLoading(false);
      return;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);

      // Mint the server-readable session cookie so admin/superadmin pages
      // can verify this login server-side, not just in client state. This
      // comes before the role lookup: the cookie is what actually gates the
      // app, so it must not depend on a lookup that can fail.
      const tokenResult = await userCredential.user.getIdTokenResult();
      await establishSession(tokenResult.token);

      // The role is only a redirect hint — every page re-checks it on the
      // server. Claims carry it for free; older accounts need one read.
      let userRole = normalizeRole(tokenResult.claims.role);
      if (!userRole) {
        try {
          const userDoc = await getDoc(
            doc(db, COLLECTIONS.USERS, userCredential.user.uid)
          );
          userRole = normalizeRole(userDoc.data()?.role) ?? "customer";
        } catch (lookupError) {
          console.error("Role lookup failed, defaulting to customer:", lookupError);
          userRole = "customer";
        }
      }

      if (onSuccess) {
        onSuccess();
      } else {
        // Redirect based on role
        if (userRole === "superadmin") {
          router.push("/superadmin");
        } else if (userRole === "owner") {
          // Owner should go to their tenant admin dashboard
          // The auth provider will load the tenant and redirect appropriately
          router.push("/");
        } else {
          // Customer goes to home
          router.push("/");
        }
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
        </div>
        <Input
          id="login-password"
          type="password"
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
