"use client";

import { useState, FormEvent } from "react";
import { useCreatePlan } from "@/hooks/use-plans";
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
import { Alert } from "@/components/ui/alert";

interface AddPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  locationId: string;
  locationName: string;
}

export function AddPlanDialog({
  open,
  onOpenChange,
  onSuccess,
  locationId,
  locationName,
}: AddPlanDialogProps) {
  const [name, setName] = useState("");
  const [priceNaira, setPriceNaira] = useState("");
  const [duration, setDuration] = useState("");
  const [dataLimit, setDataLimit] = useState("");
  const [mikrotikProfile, setMikrotikProfile] = useState("");
  const [error, setError] = useState("");

  const createPlan = useCreatePlan();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name || !priceNaira || !duration || !dataLimit || !mikrotikProfile) {
      setError("All fields are required");
      return;
    }

    const priceKobo = Math.round(parseFloat(priceNaira) * 100);
    if (isNaN(priceKobo) || priceKobo <= 0) {
      setError("Invalid price");
      return;
    }

    try {
      await createPlan.mutateAsync({
        locationId,
        locationName,
        name,
        price: priceKobo,
        duration,
        dataLimit,
        mikrotikProfile,
        active: true,
      });

      onSuccess();
      onOpenChange(false);

      // Reset form
      setName("");
      setPriceNaira("");
      setDuration("");
      setDataLimit("");
      setMikrotikProfile("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Plan</DialogTitle>
          <DialogDescription>
            Create a new hotspot plan for {locationName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Plan Name</Label>
              <Input
                id="name"
                placeholder="e.g., 1 Hour Browsing"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={createPlan.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="price">Price (₦)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                placeholder="100"
                value={priceNaira}
                onChange={(e) => setPriceNaira(e.target.value)}
                disabled={createPlan.isPending}
              />
              <p className="text-xs text-gray-500">
                Stored in kobo, displayed in Naira
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration</Label>
              <Input
                id="duration"
                placeholder="e.g., 1 hour, 24 hours, 7 days"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={createPlan.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dataLimit">Data Limit</Label>
              <Input
                id="dataLimit"
                placeholder="e.g., Unlimited, 1GB, 5GB"
                value={dataLimit}
                onChange={(e) => setDataLimit(e.target.value)}
                disabled={createPlan.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mikrotikProfile">MikroTik Profile Name</Label>
              <Input
                id="mikrotikProfile"
                placeholder="e.g., 1hr, daily, weekly"
                value={mikrotikProfile}
                onChange={(e) => setMikrotikProfile(e.target.value)}
                disabled={createPlan.isPending}
              />
              <p className="text-xs text-gray-500">
                Must match exactly the profile name on your router
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <p className="text-sm">{error}</p>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createPlan.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createPlan.isPending}>
              {createPlan.isPending ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
