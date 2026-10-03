"use client";

import { FormEvent, useEffect, useState } from "react";

import { useUpdateRouter } from "@/hooks/use-routers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { useErrorState } from "@/components/system/use-error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { Router } from "@/types/schemas";

interface EditRouterFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  router: Router | null;
}

/**
 * Editing an existing router shares no state with registering a new one --
 * no connection mode, no WireGuard phases, no provisioning. Keeping it
 * separate lets the registration dialog drop every `mode === "edit"` branch
 * it was carrying.
 */
export function EditRouterForm({
  open,
  onOpenChange,
  onSuccess,
  router,
}: EditRouterFormProps) {
  const [name, setName] = useState("");
  const [routerIp, setRouterIp] = useState("");
  const [routerUser, setRouterUser] = useState("");
  const [routerPass, setRouterPass] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useErrorState("Couldn't update router");

  const updateRouter = useUpdateRouter();
  const isPending = updateRouter.isPending;
  const isWireguard = router?.connectionMethod === "wireguard";

  useEffect(() => {
    if (!router) return;
    setName(router.name);
    setRouterIp(router.wireguardTunnelIp || router.routerIp);
    setRouterUser(router.routerUser);
    setRouterPass("");
    setActive(router.active);
    setError(null);
    // `setError` is stable; re-running on it would clear the field mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name || !routerIp || !routerUser) {
      setError("Name, IP, and username are required");
      return;
    }
    if (!router) return;

    try {
      await updateRouter.mutateAsync({
        id: router.id,
        name,
        routerIp,
        routerUser,
        active,
        // Only sent when changed -- blank means "keep the existing one".
        ...(routerPass.trim() ? { routerPass } : {}),
      });

      toast.add({
        title: "Router updated",
        description: "Router settings updated successfully.",
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update router"
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-150">
        <DialogHeader>
          <DialogTitle>Edit router</DialogTitle>
          <DialogDescription>
            Update router settings. Connection method and tunnel IP can&apos;t
            be changed. Leave the password blank to keep it unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Router name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-ip">Router IP / tunnel IP</Label>
            <Input
              id="edit-ip"
              value={routerIp}
              onChange={(e) => setRouterIp(e.target.value)}
              disabled={isPending || isWireguard}
            />
            {isWireguard && (
              <p className="text-xs text-muted-foreground">
                Tunnel IP can&apos;t be changed for WireGuard routers
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-user">Router username</Label>
            <Input
              id="edit-user"
              value={routerUser}
              onChange={(e) => setRouterUser(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-pass">Router password</Label>
            <Input
              id="edit-pass"
              type="password"
              placeholder="Leave blank to keep unchanged"
              value={routerPass}
              onChange={(e) => setRouterPass(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="edit-active">Active</Label>
            <Switch
              id="edit-active"
              checked={active}
              onCheckedChange={setActive}
              disabled={isPending}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
