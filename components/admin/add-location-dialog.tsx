"use client";

import { useState } from "react";
import { useCreateLocation } from "@/hooks/use-locations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { Location, Router } from "@/types/schemas";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  routers: Router[];
  locations: Location[];
}

export function AddLocationDialog({
  open,
  onOpenChange,
  onSuccess,
  routers,
  locations,
}: AddLocationDialogProps) {
  const [name, setName] = useState("");
  const [routerId, setRouterId] = useState("");
  const [error, setError] = useState("");

  const createLocation = useCreateLocation();

  const onlineRouters = routers.filter((r) => r.status === "online" && r.active);

  // A router can back exactly one location. Everything we do on a router -
  // the captive portal directory, the hotspot profile list, the user and
  // session lists - is router-wide, not per-location, so a second location
  // on the same router would silently share and overwrite the first one's
  // state rather than getting its own. See `docs/locations-and-routers.md`.
  const locationByRouterId = new Map(
    locations.map((location) => [location.routerId, location])
  );
  const availableRouters = onlineRouters.filter(
    (router) => !locationByRouterId.has(router.id)
  );

  const resetForm = () => {
    setName("");
    setRouterId("");
    setError("");
  };

  const handleSubmit = async () => {
    setError("");

    if (!name.trim()) {
      setError("Location name is required");
      return;
    }

    if (!routerId) {
      setError("Please select a router");
      return;
    }

    try {
      await createLocation.mutateAsync({
        name: name.trim(),
        routerId,
      });

      toast.add({
        title: "Location created",
        description: "Location saved successfully.",
        type: "success",
      });

      onSuccess();
      onOpenChange(false);
      resetForm();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to create location";
      setError(errorMessage);

      toast.add({
        title: "Failed to create location",
        description: errorMessage,
        type: "error",
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Location</DialogTitle>
          <DialogDescription>
            Create a new hotspot location on a registered router.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="location-name">Location Name</Label>
            <Input
              id="location-name"
              placeholder="e.g., Ground Floor Hotspot"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={createLocation.isPending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="router-select">Router</Label>
            {availableRouters.length === 0 ? (
              <Alert>
                <AlertDescription>
                  {onlineRouters.length === 0
                    ? "No online routers available. Please register and connect a router first from the Routers page."
                    : "Every online router already has a location. Register another router to add a location."}
                </AlertDescription>
              </Alert>
            ) : (
              <Select
                value={routerId}
                onValueChange={(value) => setRouterId(value || "")}
                disabled={createLocation.isPending}
              >
                <SelectTrigger id="router-select">
                  <SelectValue placeholder="Select a router" />
                </SelectTrigger>
                <SelectContent>
                  {onlineRouters.map((router) => {
                    const assignedTo = locationByRouterId.get(router.id);
                    return (
                      <SelectItem
                        key={router.id}
                        value={router.id}
                        disabled={Boolean(assignedTo)}
                      >
                        <div className="flex items-center gap-2">
                          <span>{router.name}</span>
                          <Badge
                            variant={
                              router.connectionMethod === "wireguard"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {router.connectionMethod === "wireguard"
                              ? "WireGuard"
                              : "Direct IP"}
                          </Badge>
                          {assignedTo && (
                            <span className="text-xs text-muted-foreground">
                              in use by {assignedTo.name}
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Only online routers are shown, and each router can back one
              location. Go to Routers to register a new one.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              resetForm();
            }}
            disabled={createLocation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              createLocation.isPending ||
              availableRouters.length === 0 ||
              !name.trim() ||
              !routerId
            }
          >
            {createLocation.isPending
              ? "Creating..."
              : "Create Location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
