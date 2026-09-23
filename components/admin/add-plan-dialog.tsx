"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreatePlan } from "@/hooks/use-plans";
import { useCreateProfile } from "@/hooks/use-profiles";
import { useLocations } from "@/hooks/use-locations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { PlanFormFields, PlanFormData } from "./plan-form-fields";

interface AddPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  locationId?: string;
  locationName?: string;
}

const planSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  locationName: z.string().min(1, "Location name is required"),
  name: z.string().min(2, "Plan name must be at least 2 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  duration: z.string().min(1, "Duration is required"),
  dataLimit: z.string().min(1, "Data limit is required"),
  mikrotikProfile: z.string(),
  active: z.boolean(),
  sameCredentials: z.boolean(),
  // New profile fields
  newProfileName: z.string(),
  newProfileRateLimit: z.string(),
  newProfileSessionTimeout: z.string(),
  newProfileSharedUsers: z.string(),
});

export function AddPlanDialog({
  open,
  onOpenChange,
  onSuccess,
  locationId,
  locationName,
}: AddPlanDialogProps) {
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const createPlan = useCreatePlan();
  const createProfile = useCreateProfile();
  const [profileTab, setProfileTab] = useState<"select" | "create">("select");
  const [error, setError] = useState("");

  const form = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      locationId: locationId || "",
      locationName: locationName || "",
      name: "",
      price: 0,
      duration: "",
      dataLimit: "",
      mikrotikProfile: "",
      active: true,
      sameCredentials: true,
      newProfileName: "",
      newProfileRateLimit: "",
      newProfileSessionTimeout: "",
      newProfileSharedUsers: "1",
    },
  });

  const onSubmit = async (data: PlanFormData) => {
    setError("");
    try {
      let profileName = data.mikrotikProfile;

      // If on "create" tab, create the profile first
      if (profileTab === "create") {
        if (!data.newProfileName || data.newProfileName.trim() === "") {
          setError("Profile name is required when creating a new profile");
          return;
        }

        const newProfile = await createProfile.mutateAsync({
          locationId: data.locationId,
          data: {
            name: data.newProfileName,
            rateLimit: data.newProfileRateLimit || undefined,
            sessionTimeout: data.newProfileSessionTimeout || undefined,
            sharedUsers: data.newProfileSharedUsers || undefined,
          },
        });

        profileName = newProfile.name;
      }

      // Convert price from Naira to kobo
      const priceKobo = Math.round(data.price * 100);

      await createPlan.mutateAsync({
        locationId: data.locationId,
        locationName: data.locationName,
        name: data.name,
        price: priceKobo,
        duration: data.duration,
        dataLimit: data.dataLimit,
        mikrotikProfile: profileName,
        active: data.active,
        sameCredentials: data.sameCredentials,
      });

      onSuccess();
      onOpenChange(false);
      form.reset();
      setProfileTab("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create plan");
      console.error("Create plan error:", err);
    }
  };

  const isPending = createPlan.isPending || createProfile.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Add New Plan</DialogTitle>
          <DialogDescription>
            Create a new hotspot plan{locationName ? ` for ${locationName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="-mx-6 max-h-[60vh] overflow-y-auto px-6 no-scrollbar">
            {locationsLoading ? (
              <div className="flex justify-center py-8">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-900"></div>
              </div>
            ) : locations.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No locations found. Please add a location first.
                </AlertDescription>
              </Alert>
            ) : (
              <PlanFormFields
                form={form}
                locations={locations}
                isSubmitting={isPending}
                locationReadOnly={!!locationId}
                profileTab={profileTab}
                onProfileTabChange={setProfileTab}
              />
            )}

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || locationsLoading || locations.length === 0}
            >
              {isPending ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
