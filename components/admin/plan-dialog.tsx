"use client";

import { useErrorState } from "@/components/system/use-error-state";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreatePlan, useUpdatePlan } from "@/hooks/use-plans";
import { useCreateProfile } from "@/hooks/use-profiles";
import { useLocations } from "@/hooks/use-locations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { PlanFormFields, PlanFormData } from "./plan-form-fields";
import { Plan } from "@/types/schemas";

interface PlanDialogProps {
  mode: "create" | "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  plan?: Plan | null;
  locationId?: string;
  locationName?: string;
}

/**
 * RouterOS `keepalive-timeout`, as HH:MM:SS. An hour means a device that goes
 * quiet holds its slot for an hour before the router frees it, which matters
 * where `shared-users` is 1: without it, a customer whose phone slept can be
 * locked out of the voucher they just paid for.
 */
const DEFAULT_KEEPALIVE_TIMEOUT = "01:00:00";

const planSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  locationName: z.string().min(1, "Location name is required"),
  name: z.string().min(2, "Plan name must be at least 2 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  duration: z.string(),
  dataLimit: z.string(),
  dataLimitUnlimited: z.boolean(),
  mikrotikProfile: z.string(),
  active: z.boolean(),
  sameCredentials: z.boolean(),
  // Duration fields
  durationValue: z.number().min(1).max(720),
  durationUnit: z.enum(["hours", "days"]),
  // Router duration fields (separate from display duration)
  routerDurationValue: z.number().int().min(1),
  routerDurationUnit: z.enum(["h", "d"]),
  // Data limit fields
  dataLimitValue: z.number().min(1).max(1000000).optional(),
  dataLimitUnit: z.enum(["MB", "GB"]),
  // New profile fields
  newProfileName: z.string(),
  newProfileRateLimit: z.string(),
  newProfileRateLimitUpload: z.number().min(0).max(1000000).optional().or(z.nan()).transform((val) => (typeof val === 'number' && !isNaN(val) ? val : undefined)),
  newProfileRateLimitDownload: z.number().min(0).max(1000000).optional().or(z.nan()).transform((val) => (typeof val === 'number' && !isNaN(val) ? val : undefined)),
  newProfileRateLimitUnit: z.enum(["Kbps", "Mbps"]),
  newProfileKeepaliveTimeout: z.string(),
  newProfileSharedUsers: z.string(),
}).refine((data) => {
  // If unlimited is off, dataLimitValue must be provided
  if (!data.dataLimitUnlimited && !data.dataLimitValue) {
    return false;
  }
  return true;
}, {
  message: "Data limit value is required when not unlimited",
  path: ["dataLimitValue"],
});

export function PlanDialog({
  mode,
  open,
  onOpenChange,
  onSuccess,
  plan,
  locationId,
  locationName,
}: PlanDialogProps) {
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const createProfile = useCreateProfile();
  const [profileTab, setProfileTab] = useState<"select" | "create">("select");
  const [error, setError] = useErrorState("Couldn't save plan");

  const form = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      locationId: locationId || "",
      locationName: locationName || "",
      name: "",
      price: 0,
      duration: "",
      dataLimit: "",
      dataLimitUnlimited: true,
      mikrotikProfile: "",
      active: true,
      sameCredentials: true,
      durationValue: 24,
      durationUnit: "hours",
      routerDurationValue: 24,
      routerDurationUnit: "h",
      dataLimitValue: 10,
      dataLimitUnit: "GB",
      newProfileName: "",
      newProfileRateLimit: "",
      newProfileRateLimitUpload: undefined,
      newProfileRateLimitDownload: undefined,
      newProfileRateLimitUnit: "Mbps",
      newProfileKeepaliveTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
      newProfileSharedUsers: "1",
    },
  });

  // Reset form when plan changes (edit mode)
  useEffect(() => {
    if (mode === "edit" && plan) {
      // Parse router duration to value + unit
      let routerDurationValue = plan.routerDurationValue ?? 1;
      let routerDurationUnit: "h" | "d" = plan.routerDurationUnit ?? "h";
      
      // For display duration, convert to hours or days
      let durationValue = 24;
      let durationUnit: "hours" | "days" = "hours";
      if (routerDurationUnit === "d") {
        durationValue = routerDurationValue;
        durationUnit = "days";
      } else {
        durationValue = routerDurationValue;
        durationUnit = "hours";
      }

      // Parse dataLimit back to value + unit + unlimited flag
      let dataLimitUnlimited = true;
      let dataLimitValue = 10;
      let dataLimitUnit: "MB" | "GB" = "GB";
      if (plan.dataLimit && plan.dataLimit !== "Unlimited") {
        dataLimitUnlimited = false;
        const match = plan.dataLimit.match(/^(\d+)(MB|GB)$/);
        if (match) {
          dataLimitValue = parseInt(match[1]);
          dataLimitUnit = match[2] as "MB" | "GB";
        }
      }

      form.reset({
        locationId: plan.locationId,
        locationName: plan.locationName,
        name: plan.name,
        price: plan.price / 100, // Convert kobo to Naira
        duration: plan.duration,
        dataLimit: plan.dataLimit ?? "",
        dataLimitUnlimited,
        mikrotikProfile: plan.mikrotikProfile,
        active: plan.active,
        sameCredentials: plan.sameCredentials ?? true,
        durationValue,
        durationUnit,
        routerDurationValue,
        routerDurationUnit,
        dataLimitValue,
        dataLimitUnit,
        newProfileName: "",
        newProfileRateLimit: "",
        newProfileRateLimitUpload: undefined,
        newProfileRateLimitDownload: undefined,
        newProfileRateLimitUnit: "Mbps",
        newProfileKeepaliveTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
        newProfileSharedUsers: "1",
      });
      setProfileTab("select");
    } else if (mode === "create" && !open) {
      // Reset form when dialog closes in create mode
      form.reset({
        locationId: locationId || "",
        locationName: locationName || "",
        name: "",
        price: 0,
        duration: "",
        dataLimit: "",
        dataLimitUnlimited: true,
        mikrotikProfile: "",
        active: true,
        sameCredentials: true,
        durationValue: 24,
        durationUnit: "hours",
        routerDurationValue: 24,
        routerDurationUnit: "h",
        dataLimitValue: 10,
        dataLimitUnit: "GB",
        newProfileName: "",
        newProfileRateLimit: "",
        newProfileRateLimitUpload: undefined,
        newProfileRateLimitDownload: undefined,
        newProfileRateLimitUnit: "Mbps",
        newProfileKeepaliveTimeout: DEFAULT_KEEPALIVE_TIMEOUT,
        newProfileSharedUsers: "1",
      });
      setProfileTab("select");
    }
  }, [mode, plan, open, form, locationId, locationName]);

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

        // Build rate-limit string from upload/download values
        let rateLimit: string | undefined = undefined;
        if (data.newProfileRateLimitUpload || data.newProfileRateLimitDownload) {
          const unit = data.newProfileRateLimitUnit === "Mbps" ? "M" : "k";
          const upload = data.newProfileRateLimitUpload ?? 0;
          const download = data.newProfileRateLimitDownload ?? 0;
          
          if (upload > 0 && download > 0) {
            rateLimit = `${upload}${unit}/${download}${unit}`;
          } else if (upload > 0) {
            rateLimit = `${upload}${unit}/0`;
          } else if (download > 0) {
            rateLimit = `0/${download}${unit}`;
          }
        }

        const newProfile = await createProfile.mutateAsync({
          locationId: data.locationId,
          data: {
            name: data.newProfileName,
            rateLimit,
            keepaliveTimeout: data.newProfileKeepaliveTimeout || undefined,
            sharedUsers: data.newProfileSharedUsers || undefined,
          },
        });

        profileName = newProfile.name;
      }

      // Convert price from Naira to kobo
      const priceKobo = Math.round(data.price * 100);

      let planId = "";
      let shouldPushScript = false;

      if (mode === "create") {
        const result = await createPlan.mutateAsync({
          locationId: data.locationId,
          locationName: data.locationName,
          name: data.name,
          price: priceKobo,
          duration: data.duration,
          routerDurationValue: data.routerDurationValue,
          routerDurationUnit: data.routerDurationUnit,
          dataLimit: data.dataLimit || null,
          mikrotikProfile: profileName,
          active: data.active,
          sameCredentials: data.sameCredentials,
        });
        planId = result.id;
        shouldPushScript = true;
      } else {
        if (!plan) return;
        
        // Check if routerDuration or mikrotikProfile changed
        const routerDurationChanged = 
          plan.routerDurationValue !== data.routerDurationValue ||
          plan.routerDurationUnit !== data.routerDurationUnit;
        const profileChanged = plan.mikrotikProfile !== profileName;
        shouldPushScript = routerDurationChanged || profileChanged;

        await updatePlan.mutateAsync({
          id: plan.id,
          data: {
            name: data.name,
            price: priceKobo,
            duration: data.duration,
            routerDurationValue: data.routerDurationValue,
            routerDurationUnit: data.routerDurationUnit,
            dataLimit: data.dataLimit || null,
            mikrotikProfile: profileName,
            active: data.active,
            sameCredentials: data.sameCredentials,
          },
        });
        planId = plan.id;
      }

      // Push on-login script if needed
      if (shouldPushScript && planId) {
        try {
          const { auth } = await import("@/lib/firebase");
          const token = auth && auth.currentUser ? await auth.currentUser.getIdToken() : null;
          if (token) {
            const scriptResponse = await fetch(`/api/admin/plans/${planId}/push-login-script`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
              },
            });

            if (!scriptResponse.ok) {
              const errorData = await scriptResponse.json();
              console.warn("Failed to push login script:", errorData.error);
              setError(`Plan ${mode === "create" ? "created" : "saved"}, but failed to configure expiry script on router: ${errorData.error}. You can retry from the plan actions menu.`);
              
              // Still close dialog after showing warning
              setTimeout(() => {
                onSuccess();
                onOpenChange(false);
                setProfileTab("select");
              }, 3000);
              return;
            }

            // Silently push expiry system setup (best effort)
            fetch(`/api/admin/locations/${data.locationId}/setup-expiry-system`, {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${token}`,
              },
            }).catch((err) => {
              console.warn("Failed to setup expiry system:", err);
            });
          }
        } catch (scriptError) {
          console.warn("Error pushing login script:", scriptError);
          setError(`Plan ${mode === "create" ? "created" : "saved"}, but failed to configure expiry script on router. You can retry from the plan actions menu.`);
          
          // Still close dialog after showing warning
          setTimeout(() => {
            onSuccess();
            onOpenChange(false);
            setProfileTab("select");
          }, 3000);
          return;
        }
      }

      onSuccess();
      onOpenChange(false);
      setProfileTab("select");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${mode === "create" ? "create" : "update"} plan`
      );
      console.error(`${mode} plan error:`, err);
    }
  };

  const isPending = createPlan.isPending || updatePlan.isPending || createProfile.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Add New Plan" : "Edit Plan"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? `Create a new hotspot plan${locationName ? ` for ${locationName}` : ""}`
              : "Update the plan details. Location cannot be changed after creation."}
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
                locationReadOnly={mode === "edit" || !!locationId}
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
              {isPending
                ? mode === "create"
                  ? "Creating..."
                  : "Saving..."
                : mode === "create"
                ? "Create Plan"
                : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
