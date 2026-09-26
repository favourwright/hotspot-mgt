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
} from "@/components/ui/dialog";
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
import { Router } from "@/types/schemas";

interface AddLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  routers: Router[];
}

export function AddLocationDialog({
  open,
  onOpenChange,
  onSuccess,
  routers,
}: AddLocationDialogProps) {
  const [name, setName] = useState("");
  const [routerId, setRouterId] = useState("");
  const [error, setError] = useState("");

  const createLocation = useCreateLocation();

  const onlineRouters = routers.filter((r) => r.status === "online" && r.active);

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
            {onlineRouters.length === 0 ? (
              <Alert>
                <AlertDescription>
                  No online routers available. Please register and connect a router first from the Routers page.
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
                  {onlineRouters.map((router) => (
                    <SelectItem
                      key={router.id}
                      value={router.id}
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
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-muted-foreground">
              Only online routers are shown. Go to Routers to register a new one.
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
              onlineRouters.length === 0 ||
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
