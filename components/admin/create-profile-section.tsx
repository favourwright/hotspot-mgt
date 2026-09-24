"use client";

import { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface NewProfileFormData {
  name: string;
  rateLimit: string;
  sessionTimeout: string;
  sharedUsers: string;
}

interface CreateProfileSectionProps {
  form: UseFormReturn<any>;
  isSubmitting?: boolean;
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
  form,
  isSubmitting = false,
}: CreateProfileSectionProps) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 mt-2">
      <div className="space-y-4">
        {/* Profile Name - Full Width */}
        <Field>
          <FieldLabel htmlFor="newProfileName">Profile Name *</FieldLabel>
          <Input
            id="newProfileName"
            placeholder="e.g., 1hr"
            {...form.register("newProfileName")}
            disabled={isSubmitting}
          />
          {form.formState.errors.newProfileName?.message && (
            <FieldDescription className="text-destructive">
              {String(form.formState.errors.newProfileName.message)}
            </FieldDescription>
          )}
        </Field>

        {/* Rate Limit and Session Timeout in Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="newProfileRateLimit">Rate Limit</FieldLabel>
            <Input
              id="newProfileRateLimit"
              placeholder="e.g., 2M/2M"
              {...form.register("newProfileRateLimit")}
              disabled={isSubmitting}
            />
            <FieldDescription>
              uploadM/downloadM (leave empty for unlimited)
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="newProfileSessionTimeout">Session Timeout</FieldLabel>
            <Input
              id="newProfileSessionTimeout"
              placeholder="e.g., 01:00:00"
              {...form.register("newProfileSessionTimeout")}
              disabled={isSubmitting}
            />
            <FieldDescription>
              HH:MM:SS (leave empty for unlimited)
            </FieldDescription>
            {form.formState.errors.newProfileSessionTimeout?.message && (
              <FieldDescription className="text-destructive">
                {String(form.formState.errors.newProfileSessionTimeout.message)}
              </FieldDescription>
            )}
          </Field>
        </div>

        {/* Shared Users */}
        <Field>
          <FieldLabel htmlFor="newProfileSharedUsers">Shared Users</FieldLabel>
          <Select
            value={form.watch("newProfileSharedUsers") || undefined}
            onValueChange={(value) => value && form.setValue("newProfileSharedUsers", value)}
            disabled={isSubmitting}
          >
            <SelectTrigger id="newProfileSharedUsers">
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
        </Field>
      </div>
    </div>
  );
}
