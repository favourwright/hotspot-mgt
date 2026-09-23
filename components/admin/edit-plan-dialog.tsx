"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUpdatePlan } from "@/hooks/use-plans";
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
  dataLimit: z.string().min(1, "Data limit is required"),
  mikrotikProfile: z.string().min(1, "MikroTik profile is required"),
  active: z.boolean(),
});

export function EditPlanDialog({
  open,
  onOpenChange,
  onSuccess,
  plan,
}: EditPlanDialogProps) {
  const { data: locations = [], isLoading: locationsLoading } = useLocations();
  const updatePlan = useUpdatePlan();

  const form = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      locationId: "",
      locationName: "",
      name: "",
      price: 0,
      duration: "",
      dataLimit: "",
      mikrotikProfile: "",
      active: true,
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
        dataLimit: plan.dataLimit,
        mikrotikProfile: plan.mikrotikProfile,
        active: plan.active,
      });
    }
  }, [plan, form]);

  const onSubmit = async (data: PlanFormData) => {
    if (!plan) return;

    try {
      // Convert price from Naira to kobo
      const priceKobo = Math.round(data.price * 100);

      await updatePlan.mutateAsync({
        id: plan.id,
        data: {
          name: data.name,
          price: priceKobo,
          duration: data.duration,
          dataLimit: data.dataLimit,
          mikrotikProfile: data.mikrotikProfile,
          active: data.active,
        },
      });

      onSuccess();
      onOpenChange(false);
    } catch (err) {
      // Error will be shown by the mutation
      console.error("Update plan error:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Edit Plan</DialogTitle>
          <DialogDescription>
            Update the plan details. Location cannot be changed after creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
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
              isSubmitting={updatePlan.isPending}
              locationReadOnly={true}
            />
          )}

          {updatePlan.isError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {updatePlan.error instanceof Error
                  ? updatePlan.error.message
                  : "Failed to update plan"}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={updatePlan.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updatePlan.isPending || locationsLoading || locations.length === 0}
            >
              {updatePlan.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
