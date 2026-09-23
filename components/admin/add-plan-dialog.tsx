"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreatePlan } from "@/hooks/use-plans";
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
  mikrotikProfile: z.string().min(1, "MikroTik profile is required"),
  active: z.boolean(),
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
    },
  });

  const onSubmit = async (data: PlanFormData) => {
    try {
      // Convert price from Naira to kobo
      const priceKobo = Math.round(data.price * 100);

      await createPlan.mutateAsync({
        locationId: data.locationId,
        locationName: data.locationName,
        name: data.name,
        price: priceKobo,
        duration: data.duration,
        dataLimit: data.dataLimit,
        mikrotikProfile: data.mikrotikProfile,
        active: data.active,
      });

      onSuccess();
      onOpenChange(false);
      form.reset();
    } catch (err) {
      // Error will be shown by the mutation
      console.error("Create plan error:", err);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Add New Plan</DialogTitle>
          <DialogDescription>
            Create a new hotspot plan{locationName ? ` for ${locationName}` : ""}
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
              isSubmitting={createPlan.isPending}
              locationReadOnly={!!locationId}
            />
          )}

          {createPlan.isError && (
            <Alert variant="destructive" className="mt-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {createPlan.error instanceof Error
                  ? createPlan.error.message
                  : "Failed to create plan"}
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createPlan.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createPlan.isPending || locationsLoading || locations.length === 0}
            >
              {createPlan.isPending ? "Creating..." : "Create Plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
