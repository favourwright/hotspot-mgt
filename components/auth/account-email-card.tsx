"use client";

import { useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { auth } from "@/lib/firebase";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Button as SystemButton } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

/**
 * The account's email address: what it is, whether it is confirmed, and how
 * to change it. Shared by the customer profile page and the tenant settings
 * page, because the flow is identical and the stakes differ only in copy.
 *
 * ## Why the password dialog is not decoration
 *
 * Changing an email is a full account takeover if a stolen session can do it
 * unchallenged - move the recovery address, then reset the password to it.
 * The client SDK would normally refuse a stale session itself, but the link
 * is minted by the Admin SDK on our server, which does not, so the server
 * checks `auth_time` instead (lib/email-identity.ts). This dialog is how the
 * caller satisfies that check: `reauthenticateWithCredential` is the only
 * thing that moves `auth_time`, and a plain token refresh will not do it.
 *
 * Required whether or not the current address is verified. The threat is the
 * live session, and that is the same either way - if anything it is worse
 * when unverified, since the real owner gets no warning they can read.
 */
export function AccountEmailCard({
  description,
  accountUid,
  accountEmail,
}: {
  /** One line on why this address matters to this audience. */
  description: string;
  /**
   * Whose account this card is about.
   *
   * Load-bearing, and the reason this prop exists at all: a superadmin can
   * open any tenant's settings page, and without it the card rendered *their
   * own* address there with live Change and Send buttons. Nothing could be
   * changed on the tenant - every action runs against the caller's own token,
   * and the API refuses a superadmin on writes anyway - but it read as though
   * it were the tenant's address, which invites a superadmin to "fix" a
   * tenant's email and silently change their own instead.
   */
  accountUid: string;
  /**
   * The address to display when the viewer is not the account holder. The
   * signed-in user's own email would be the wrong thing to show on someone
   * else's settings page.
   */
  accountEmail?: string;
}) {
  const { user } = useAuth();

  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  if (!user) return null;

  // Viewing someone else's account: show what it is, offer nothing. Mirrors
  // the "a superadmin can view, but not act on, any tenant's data" rule the
  // rest of the app already follows (docs/auth-and-security.md).
  const isOwnAccount = user.uid === accountUid;

  if (!isOwnAccount) {
    return (
      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Email address</SurfaceCardTitle>
          <SurfaceCardDescription>{description}</SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent className="space-y-2">
          <p className="truncate font-medium">
            {accountEmail || (
              <span className="text-muted-foreground">Not set</span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Only the account holder can change this or confirm it. You are
            signed in as someone else.
          </p>
        </SurfaceCardContent>
      </SurfaceCard>
    );
  }

  const verified = user.emailVerified;

  function openDialog() {
    setNewEmail("");
    setPassword("");
    setError("");
    setEditing(true);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    const target = newEmail.trim().toLowerCase();
    if (!target) {
      setError("Enter the address you want to use.");
      return;
    }
    if (target === (user?.email ?? "").toLowerCase()) {
      setError("That is already your email address.");
      return;
    }

    setSaving(true);
    try {
      // Proves they know the password, and - the part that matters - moves
      // `auth_time` so the server's recency check passes.
      const credential = EmailAuthProvider.credential(
        user!.email ?? "",
        password
      );
      await reauthenticateWithCredential(user!, credential);

      const token = await user!.getIdToken(true);
      const response = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: target }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      setPending(target);
      setEditing(false);
      toast.add({
        title: "Check your new inbox",
        description: `We sent a confirmation link to ${target}. Your address changes when you click it.`,
        type: "success",
      });
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code.includes("wrong-password") || code.includes("invalid-credential")) {
        setError("That password isn't right.");
      } else if (code.includes("too-many-requests")) {
        setError("Too many attempts. Wait a few minutes and try again.");
      } else {
        setError(err instanceof Error ? err.message : "Could not change your email.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function resend() {
    setResending(true);
    try {
      const token = await user!.getIdToken();
      const response = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      toast.add({
        title: data.data?.alreadyVerified
          ? "Already confirmed"
          : "Check your inbox",
        description: data.data?.alreadyVerified
          ? "This address is confirmed. Reload the page to clear the notice."
          : `We sent a confirmation link to ${user!.email}.`,
        type: "success",
      });
    } catch (err) {
      toast.add({
        title: "Couldn't send that",
        description: err instanceof Error ? err.message : "Try again shortly.",
        type: "error",
      });
    } finally {
      setResending(false);
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Email address</SurfaceCardTitle>
        <SurfaceCardDescription>{description}</SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate font-medium">{user.email}</p>
            {verified ? (
              <Badge variant="secondary" className="gap-1">
                <CircleCheck className="size-3" />
                Confirmed
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <TriangleAlert className="size-3" />
                Not confirmed yet
              </Badge>
            )}
          </div>
          {/* In-card actions use the system button at the compact scale, the
              same as the superadmin list rows. The dialog's own footer uses
              the base button, matching billing-plan-dialog.tsx. */}
          <div className="flex gap-2">
            {!verified && (
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={resend}
                disabled={resending}
              >
                {resending ? "Sending..." : "Send link"}
              </SystemButton>
            )}
            <SystemButton tone="raised" scale="sm" onClick={openDialog}>
              Change
            </SystemButton>
          </div>
        </div>

        {pending && (
          <Alert>
            <TriangleAlert className="size-4" />
            <AlertDescription>
              Waiting on {pending}. Your address changes once you click the
              link we sent there - until then this account still uses{" "}
              {user.email}.
            </AlertDescription>
          </Alert>
        )}
      </SurfaceCardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        {/*
          Same shape as the superadmin dialogs (billing-plan-dialog.tsx): the
          shared width, the scroll wrapper around the content only, and a
          footer of two equal-width buttons outside it. A form element still
          wraps the lot so Enter submits - invisible, and the pattern is about
          what shows.
        */}
        <DialogContent className="sm:max-w-137.5">
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Change your email address</DialogTitle>
              <DialogDescription>
                We will send a confirmation link to the new address. Nothing
                changes until you click it, so you can do this even if you
                cannot read the address you have now.
              </DialogDescription>
            </DialogHeader>

            <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
              {error && (
                <Alert variant="destructive">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="new-email">New email address</Label>
                  <Input
                    id="new-email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    disabled={saving}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Your password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={saving}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Confirms it is really you before we move where your account
                    can be recovered from.
                  </p>
                </div>
              </div>
            </div>

            <DialogFooter className="flex flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="flex-1">
                {saving ? "Sending..." : "Send Link"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SurfaceCard>
  );
}
