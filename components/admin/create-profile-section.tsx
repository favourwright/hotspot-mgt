"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateProfile } from "@/hooks/use-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { MikrotikProfile } from "@/types/schemas";

const profileSchema = z.object({
  name: z.string().min(1, "Profile name is required"),
  rateLimit: z.string().optional(),
  sessionTimeout: z
    .string()
    .regex(/^(\d{2}:\d{2}:\d{2})?$/, "Format must be HH:MM:SS or empty")
    .optional(),
  sharedUsers: z.string().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

interface CreateProfileSectionProps {
  locationId: string;
  onSuccess: (profile: MikrotikProfile) => void;
  onCancel: () => void;
}

const SHARED_USERS_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
  { value: "10", label: "10" },
  { value: "unlimited", label: "Unlimited" },
];

export function CreateProfileSection({
  locationId,
  onSuccess,
  onCancel,
}: CreateProfileSectionProps) {
  const [error, setError] = useState("");
  const createProfile = useCreateProfile();

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      rateLimit: "",
      sessionTimeout: "",
      sharedUsers: "1",
    },
  });

  const onSubmit = async (data: ProfileFormData) => {
    setError("");
    try {
      const result = await createProfile.mutateAsync({
        locationId,
        data: {
          name: data.name,
          rateLimit: data.rateLimit || undefined,
          sessionTimeout: data.sessionTimeout || undefined,
          sharedUsers: data.sharedUsers || undefined,
        },
      });
      onSuccess(result);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create profile");
    }
  };

  return (
    <div className="mt-3 rounded-lg border bg-muted/50 p-4">
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="profileName" className="text-sm">
            Profile Name *
          </Label>
          <Input
            id="profileName"
            placeholder="e.g., 1hr"
            {...form.register("name")}
            disabled={createProfile.isPending}
          />
          {form.formState.errors.name && (
            <p className="text-xs text-destructive">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="rateLimit" className="text-sm">
            Rate Limit
          </Label>
          <Input
            id="rateLimit"
            placeholder="e.g., 2M/2M"
            {...form.register("rateLimit")}
            disabled={createProfile.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Format: uploadM/downloadM (leave empty for unlimited)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sessionTimeout" className="text-sm">
            Session Timeout
          </Label>
          <Input
            id="sessionTimeout"
            placeholder="e.g., 01:00:00"
            {...form.register("sessionTimeout")}
            disabled={createProfile.isPending}
          />
          <p className="text-xs text-muted-foreground">
            Format: HH:MM:SS (leave empty for unlimited)
          </p>
          {form.formState.errors.sessionTimeout && (
            <p className="text-xs text-destructive">
              {form.formState.errors.sessionTimeout.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sharedUsers" className="text-sm">
            Shared Users
          </Label>
          <Select
            value={form.watch("sharedUsers") || undefined}
            onValueChange={(value) => value && form.setValue("sharedUsers", value)}
            disabled={createProfile.isPending}
          >
            <SelectTrigger id="sharedUsers">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHARED_USERS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={createProfile.isPending}
            className="flex-1"
          >
            {createProfile.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Profile"
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={createProfile.isPending}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
