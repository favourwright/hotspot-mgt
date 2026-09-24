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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

export interface NewProfileFormData {
  name: string;
  rateLimit: string;
  rateLimitUpload: number;
  rateLimitDownload: number;
  rateLimitUnit: "Kbps" | "Mbps";
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

const RATE_LIMIT_UNITS = ["Kbps", "Mbps"] as const;

export function CreateProfileSection({
  form,
  isSubmitting = false,
}: CreateProfileSectionProps) {
  const rateLimitUnit = form.watch("newProfileRateLimitUnit") || "Mbps";

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
          {/* Rate Limit Upload */}
          <Field>
            <FieldLabel htmlFor="newProfileRateLimitUpload">Upload Speed (optional)</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="newProfileRateLimitUpload"
                type="number"
                min="1"
                max={rateLimitUnit === "Mbps" ? "1000" : "1000000"}
                placeholder="2"
                {...form.register("newProfileRateLimitUpload", { valueAsNumber: true })}
                disabled={isSubmitting}
              />
              <InputGroupAddon align="inline-end">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <InputGroupButton variant="ghost" className="pr-1.5! text-xs">
                        {rateLimitUnit} <ChevronDown className="size-3" />
                      </InputGroupButton>
                    }
                  />
                  <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4}>
                    {RATE_LIMIT_UNITS.map((unit) => (
                      <DropdownMenuItem
                        key={unit}
                        onClick={() => form.setValue("newProfileRateLimitUnit", unit)}
                      >
                        {unit}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </InputGroupAddon>
            </InputGroup>
          </Field>

          {/* Rate Limit Download */}
          <Field>
            <FieldLabel htmlFor="newProfileRateLimitDownload">Download Speed (optional)</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="newProfileRateLimitDownload"
                type="number"
                min="1"
                max={rateLimitUnit === "Mbps" ? "1000" : "1000000"}
                placeholder="2"
                {...form.register("newProfileRateLimitDownload", { valueAsNumber: true })}
                disabled={isSubmitting}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton variant="ghost" className="pr-1.5! text-xs" disabled>
                  {rateLimitUnit} <ChevronDown className="size-3" />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </div>

        {/* Session Timeout */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="newProfileSessionTimeout">Session Timeout (optional)</FieldLabel>
            <Input
              id="newProfileSessionTimeout"
              placeholder="e.g., 01:00:00"
              {...form.register("newProfileSessionTimeout")}
              disabled={isSubmitting}
            />
            {form.formState.errors.newProfileSessionTimeout?.message && (
              <FieldDescription className="text-destructive">
                {String(form.formState.errors.newProfileSessionTimeout.message)}
              </FieldDescription>
            )}
          </Field>

          {/* Shared Users - Full Width */}
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
    </div>
  );
}
