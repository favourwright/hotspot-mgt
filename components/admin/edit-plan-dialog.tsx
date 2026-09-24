"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdatePlan } from "@/hooks/use-plans";
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
import { Plan } from "@/types/schemas";

interface EditPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  plan: Plan | null;
}

const planSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  locationName: z.string().min(1, "Location name is required"),
  name: z.string().min(2, "Plan name must be at least 2 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  duration: z.string().min(1, "Duration is required"),
  routerDuration: z.string().min(1, "Router duration is required"),
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

export function EditPlanDialog({
  open,
  onOpenChange,
  onSuccess,
  plan,
}: EditPlanDialogProps) {
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const updatePlan = useUpdatePlan();
  const createProfile = useCreateProfile();
  const [profileTab, setProfileTab] = useState<"select" | "create">("select");
  const [error, setError] = useState("");

  const form = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      locationId: "",
      locationName: "",
      name: "",
      price: 0,
      duration: "",
      routerDuration: "",
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

  // Reset form when plan changes
  useEffect(() => {
    if (plan) {
      form.reset({
        locationId: plan.locationId,
        locationName: plan.locationName,
        name: plan.name,
        price: plan.price / 100, // Convert kobo to Naira
        duration: plan.duration,
        routerDuration: plan.routerDuration || "",
        dataLimit: plan.dataLimit ?? "",
        mikrotikProfile: plan.mikrotikProfile,
        active: plan.active,
        sameCredentials: plan.sameCredentials ?? true, // Default to true for existing plans
        newProfileName: "",
        newProfileRateLimit: "",
        newProfileSessionTimeout: "",
        newProfileSharedUsers: "1",
      });
      setProfileTab("select");
    }
  }, [plan, form]);

  const onSubmit = async (data: PlanFormData) => {
    if (!plan) return;
    
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

      await updatePlan.mutateAsync({
        id: plan.id,
        data: {
          name: data.name,
          price: priceKobo,
          duration: data.duration,
          routerDuration: data.routerDuration,
          dataLimit: data.dataLimit || null,
          mikrotikProfile: profileName,
          active: data.active,
          sameCredentials: data.sameCredentials,
        },
      });

      onSuccess();
      onOpenChange(false);
      setProfileTab("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
      console.error("Update plan error:", err);
    }
  };

  const isPending = updatePlan.isPending || createProfile.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Edit Plan</DialogTitle>
          <DialogDescription>
            Update the plan details. Location cannot be changed after creation.
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
                locationReadOnly={true}
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
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
