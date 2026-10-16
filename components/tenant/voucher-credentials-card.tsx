"use client";

import { useEffect, useState } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";
import { Button as SystemButton } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/toast";
import {
  HANDLE_MAX_LENGTH,
  VOUCHER_PASSWORD_MAX_LENGTH,
  VOUCHER_PASSWORD_MIN_LENGTH,
  normaliseHandle,
  validateHandle,
  validateVoucherPassword,
} from "@/lib/voucher-credentials";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";

/**
 * Lets a customer choose the username and password their vouchers will use.
 *
 * The thing this card has to communicate, and the reason the copy is as
 * blunt as it is: the name they type is not the name they get. Their
 * username is the handle plus a fixed four-character tail, which exists so
 * that no two customers can collide and nobody can learn a username by
 * asking whether it is taken (lib/voucher-credentials.ts). A card that
 * showed only the handle would leave them typing the wrong thing into a
 * login page at the one moment they cannot ask anyone.
 *
 * The rules are checked here and again on the server. This copy is for
 * getting it right the first time; the server's is the one that holds.
 */
export function VoucherCredentialsCard({
  tenantSlug,
  businessName,
}: {
  tenantSlug: string;
  businessName: string;
}) {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      try {
        const token = await user.getIdToken();
        const response = await fetch(
          `/api/tenant/${tenantSlug}/voucher-credentials`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (cancelled || !data.success || !data.data) return;
        setUsername(data.data.username);
        setHandle(data.data.handle);
        setPassword(data.data.password);
      } catch {
        // Nothing to show is the correct empty state here: the card still
        // works as a form, and a customer who has never set credentials and
        // one whose fetch failed want the same thing from it.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, tenantSlug]);

  if (!user) return null;

  async function save() {
    setError("");

    const normalised = normaliseHandle(handle);
    const handleCheck = validateHandle(normalised);
    if (!handleCheck.ok) {
      setError(handleCheck.error);
      return;
    }

    const passwordCheck = validateVoucherPassword(password, {
      handle: normalised,
      email: user!.email,
    });
    if (!passwordCheck.ok) {
      setError(passwordCheck.error);
      return;
    }

    setSaving(true);
    try {
      const token = await user!.getIdToken();
      const response = await fetch(
        `/api/tenant/${tenantSlug}/voucher-credentials`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ handle: normalised, password }),
        }
      );
      const data = await response.json();
      if (!data.success) throw new Error(data.error);

      setUsername(data.data.username);
      setHandle(data.data.handle);
      toast.add({
        title: "Saved",
        description: `Your next voucher from ${businessName} will use ${data.data.username}.`,
        type: "success",
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save that. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Your wifi login (optional)</SurfaceCardTitle>
        <SurfaceCardDescription>
          Choose what you sign in with, so you never have to look up a code
          again. Leave this blank and every voucher gets a random one, as
          before.
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        {username && (
          <Alert>
            <CircleCheck className="size-4" />
            <AlertDescription>
              Your username is <span className="font-medium">{username}</span>.
              The last few characters are added automatically and never
              change, so this is the whole thing - type it exactly as it
              appears.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="voucher-handle">Username</Label>
          <Input
            id="voucher-handle"
            value={handle}
            maxLength={HANDLE_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            placeholder="nkechi"
            onChange={(event) => setHandle(event.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            Lowercase letters, numbers, dots, hyphens and underscores.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="voucher-password">Password</Label>
          <Input
            id="voucher-password"
            value={password}
            placeholder="Choose a secure password"
            maxLength={VOUCHER_PASSWORD_MAX_LENGTH}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-muted-foreground text-sm">
            At least {VOUCHER_PASSWORD_MIN_LENGTH} characters, and not the
            same as your username.
          </p>
        </div>

      </SurfaceCardContent>

      <SurfaceCardFooter variant="toolbar" className="flex flex-col">
        {/* Said plainly rather than buried in a tooltip. This value is
            stored as typed and is visible to the business you buy from -
            which is right for a code on their router, and exactly why it
            must not be a password that opens anything else. */}
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertDescription>
            This is a wifi code, not an account password. {businessName} can
            see it, the same as any voucher they issue. Do not reuse a
            password you use anywhere else.
          </AlertDescription>
        </Alert>

        {error && (
          <Alert variant="destructive">
            <TriangleAlert className="size-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="w-full flex items-center justify-between gap-3">
          {/* The rule that surprises people, so it is on the card rather
              than in a toast after the fact: a voucher already running
              keeps the code it was issued with. Renaming a user that is
              signed in would cut them off mid-session. */}
          <p className="text-muted-foreground text-sm">
            Changes apply to your next voucher. Any you are using now keep
            the code they came with.
          </p>
          <SystemButton
            tone="field"
            scale="sm"
            onClick={save}
            disabled={saving || loading}
          >
            {saving ? "Saving..." : "Save"}
          </SystemButton>
        </div>
      </SurfaceCardFooter>
    </SurfaceCard>
  );
}
