"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { USERS_COLLECTION } from "@/lib/firebase-collections";
import { getFirebaseErrorMessage } from "@/lib/firebase-errors";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function AuthDialog({ open, onOpenChange, onSuccess }: AuthDialogProps) {
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const router = useRouter();

  // Login state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Register state
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registerError, setRegisterError] = useState("");
  const [registerLoading, setRegisterLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");

    if (!auth || !db) {
      setLoginError("Firebase is not initialized");
      return;
    }

    if (!loginEmail || !loginPassword) {
      setLoginError("All fields are required");
      return;
    }

    setLoginLoading(true);

    try {
      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      
      // Get user role from Firestore
      const userDoc = await getDoc(doc(db, USERS_COLLECTION, userCredential.user.uid));
      
      if (!userDoc.exists()) {
        throw new Error("User profile not found");
      }

      const userData = userDoc.data();
      const role = userData.role;

      // If admin, redirect to admin
      if (role === "admin") {
        router.push("/admin");
        onOpenChange(false);
      } else {
        // Customer - close dialog and trigger success callback
        onOpenChange(false);
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        const errorCode = (error as { code?: string }).code;
        setLoginError(errorCode ? getFirebaseErrorMessage(errorCode) : error.message);
      } else {
        setLoginError("Something went wrong. Please try again");
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError("");

    if (!auth) {
      setRegisterError("Firebase is not initialized");
      return;
    }

    if (!registerEmail || !registerPassword || !confirmPassword) {
      setRegisterError("All fields are required");
      return;
    }

    if (registerPassword.length < 8) {
      setRegisterError("Password must be at least 8 characters");
      return;
    }

    if (registerPassword !== confirmPassword) {
      setRegisterError("Passwords do not match");
      return;
    }

    setRegisterLoading(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(auth, registerEmail, registerPassword);
      const idToken = await userCredential.user.getIdToken();

      // Call API to create Firestore user document
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          uid: userCredential.user.uid,
          email: userCredential.user.email,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || "Failed to complete registration");
      }

      const role = result.data.role;

      // If admin, redirect to admin
      if (role === "admin") {
        router.push("/admin");
        onOpenChange(false);
      } else {
        // Customer - close dialog and trigger success callback
        onOpenChange(false);
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        const errorCode = (error as { code?: string }).code;
        setRegisterError(errorCode ? getFirebaseErrorMessage(errorCode) : error.message);
      } else {
        setRegisterError("Something went wrong. Please try again");
      }
    } finally {
      setRegisterLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Authentication Required</DialogTitle>
          <DialogDescription>
            Please sign in or create an account to purchase this plan
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "login" | "register")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Sign In</TabsTrigger>
            <TabsTrigger value="register">Sign Up</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <Label htmlFor="login-email">Email address</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="email@example.com"
                  autoComplete="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="mt-1"
                  disabled={loginLoading}
                />
              </div>

              <div>
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="• • • • •"
                  autoComplete="current-password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="mt-1"
                  disabled={loginLoading}
                />
              </div>

              {loginError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-800">{loginError}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loginLoading}>
                {loginLoading ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="register">
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <Label htmlFor="register-email">Email address</Label>
                <Input
                  id="register-email"
                  type="email"
                  placeholder="email@example.com"
                  autoComplete="email"
                  required
                  value={registerEmail}
                  onChange={(e) => setRegisterEmail(e.target.value)}
                  className="mt-1"
                  disabled={registerLoading}
                />
              </div>

              <div>
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  placeholder="• • • • •"
                  autoComplete="new-password"
                  required
                  value={registerPassword}
                  onChange={(e) => setRegisterPassword(e.target.value)}
                  className="mt-1"
                  disabled={registerLoading}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Must be at least 8 characters
                </p>
              </div>

              <div>
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="• • • • •"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1"
                  disabled={registerLoading}
                />
              </div>

              {registerError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-800">{registerError}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={registerLoading}>
                {registerLoading ? "Creating account..." : "Create account"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
