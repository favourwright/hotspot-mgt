"use client";

import { UseFormReturn } from "react-hook-form";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, AlertCircle } from "lucide-react";
import { useProfiles } from "@/hooks/use-profiles";
import { Location, MikrotikProfile } from "@/types/schemas";
import { CreateProfileSection } from "./create-profile-section";

export interface PlanFormData {
  locationId: string;
  locationName: string;
  name: string;
  price: number;
  duration: string;
  routerDuration: string;
  dataLimit: string;
  mikrotikProfile: string;
  active: boolean;
  sameCredentials: boolean;
  // New profile fields (only used when creating new profile)
  newProfileName: string;
  newProfileRateLimit: string;
  newProfileSessionTimeout: string;
  newProfileSharedUsers: string;
}

interface PlanFormFieldsProps {
  form: UseFormReturn<PlanFormData>;
  locations: Location[];
  isSubmitting: boolean;
  locationReadOnly?: boolean;
  profileTab: "select" | "create";
  onProfileTabChange: (tab: "select" | "create") => void;
}

const DURATION_OPTIONS = [
  { label: "1 hour", duration: "1 hour", routerDuration: "1h" },
  { label: "2 hours", duration: "2 hours", routerDuration: "2h" },
  { label: "3 hours", duration: "3 hours", routerDuration: "3h" },
  { label: "6 hours", duration: "6 hours", routerDuration: "6h" },
  { label: "12 hours", duration: "12 hours", routerDuration: "12h" },
  { label: "24 hours", duration: "24 hours", routerDuration: "1d" },
  { label: "2 days", duration: "2 days", routerDuration: "2d" },
  { label: "3 days", duration: "3 days", routerDuration: "3d" },
  { label: "7 days", duration: "7 days", routerDuration: "7d" },
  { label: "30 days", duration: "30 days", routerDuration: "30d" },
];

const DATA_LIMIT_OPTIONS = [
  { value: "Unlimited", label: "Unlimited" },
  { value: "500MB", label: "500MB" },
  { value: "1GB", label: "1GB" },
  { value: "2GB", label: "2GB" },
  { value: "5GB", label: "5GB" },
  { value: "10GB", label: "10GB" },
  { value: "20GB", label: "20GB" },
];

export function PlanFormFields({
  form,
  locations,
  isSubmitting,
  locationReadOnly = false,
  profileTab,
  onProfileTabChange,
}: PlanFormFieldsProps) {
  const selectedLocationId = form.watch("locationId");
  const priceNaira = form.watch("price");

  const {
    data: profiles,
    isLoading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useProfiles(selectedLocationId || null);

  const handleLocationChange = (locationId: string | null) => {
    if (!locationId) return;
    const location = locations.find((loc) => loc.id === locationId);
    if (location) {
      form.setValue("locationId", locationId);
      form.setValue("locationName", location.name);
      // Reset profile when location changes
      form.setValue("mikrotikProfile", "");
      onProfileTabChange("select"); // Reset to select tab
    }
  };

  const formatProfileDisplay = (profile: MikrotikProfile) => {
    const rateLimit = profile["rate-limit"];
    return rateLimit ? `${profile.name} (${rateLimit})` : profile.name;
  };

  const formatPriceDisplay = (kobo: number) => {
    if (isNaN(kobo) || kobo === 0) return "";
    return `₦${(kobo / 100).toFixed(2)}`;
  };

  return (
    <div className="space-y-6">
      {/* Location Field */}
      <Field>
        <FieldLabel htmlFor="locationId">Location *</FieldLabel>
        {locationReadOnly ? (
          <Input
            value={
              locations.find((loc) => loc.id === selectedLocationId)?.name || ""
            }
            disabled
            className="bg-muted"
          />
        ) : (
          <Select
            value={selectedLocationId}
            onValueChange={handleLocationChange}
            disabled={isSubmitting}
          >
            <SelectTrigger id="locationId">
              <SelectValue placeholder="Select a location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {form.formState.errors.locationId && (
          <FieldDescription className="text-destructive">
            {form.formState.errors.locationId.message}
          </FieldDescription>
        )}
      </Field>

      {/* Plan Name Field */}
      <Field>
        <FieldLabel htmlFor="name">Plan Name *</FieldLabel>
        <Input
          id="name"
          placeholder="e.g., 1 Hour Browsing"
          {...form.register("name")}
          disabled={isSubmitting}
        />
        {form.formState.errors.name && (
          <FieldDescription className="text-destructive">
            {form.formState.errors.name.message}
          </FieldDescription>
        )}
      </Field>

      {/* Price, Duration, and Data Limit in Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Price Field */}
        <Field>
          <FieldLabel htmlFor="price">Price (₦) *</FieldLabel>
          <Input
            id="price"
            type="number"
            step="0.01"
            min="1"
            placeholder="100"
            {...form.register("price", { valueAsNumber: true })}
            disabled={isSubmitting}
          />
          {priceNaira > 0 && (
            <FieldDescription>
              {formatPriceDisplay(priceNaira * 100)}
            </FieldDescription>
          )}
          {form.formState.errors.price && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.price.message}
            </FieldDescription>
          )}
        </Field>

        {/* Duration Field */}
        <Field>
          <FieldLabel htmlFor="duration">Duration *</FieldLabel>
          <Select
            value={form.watch("routerDuration") || undefined}
            onValueChange={(routerDuration) => {
              if (routerDuration) {
                const option = DURATION_OPTIONS.find(opt => opt.routerDuration === routerDuration);
                if (option) {
                  form.setValue("duration", option.duration);
                  form.setValue("routerDuration", option.routerDuration);
                }
              }
            }}
            disabled={isSubmitting}
          >
            <SelectTrigger id="duration">
              <SelectValue placeholder="Select duration" />
            </SelectTrigger>
            <SelectContent>
              {DURATION_OPTIONS.map((option) => (
                <SelectItem key={option.routerDuration} value={option.routerDuration}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.duration && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.duration.message}
            </FieldDescription>
          )}
        </Field>

        {/* Data Limit Field */}
        <Field>
          <FieldLabel htmlFor="dataLimit">Data Limit *</FieldLabel>
          <Select
            value={form.watch("dataLimit") || undefined}
            onValueChange={(value) => value && form.setValue("dataLimit", value)}
            disabled={isSubmitting}
          >
            <SelectTrigger id="dataLimit">
              <SelectValue placeholder="Select data limit" />
            </SelectTrigger>
            <SelectContent>
              {DATA_LIMIT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.dataLimit && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.dataLimit.message}
            </FieldDescription>
          )}
        </Field>
      </div>

      {/* MikroTik Profile Field */}
      <Field>
        <FieldLabel>MikroTik Profile *</FieldLabel>
        
        {!selectedLocationId ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please select a location first to load profiles
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs value={profileTab} onValueChange={(v) => onProfileTabChange(v as "select" | "create")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="select">Select Existing</TabsTrigger>
              <TabsTrigger value="create">Create New</TabsTrigger>
            </TabsList>
            
            <TabsContent value="select" className="space-y-2">
              {profilesLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Loading profiles from router...
                  </span>
                </div>
              ) : profilesError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>Could not fetch profiles from router. Check that the router is online.</span>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => refetchProfiles()}
                      className="h-auto p-0"
                    >
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={form.watch("mikrotikProfile") || undefined}
                  onValueChange={(value) => value && form.setValue("mikrotikProfile", value)}
                  disabled={isSubmitting || !profiles || profiles.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles && profiles.length > 0 ? (
                      profiles.map((profile) => (
                        <SelectItem key={profile[".id"]} value={profile.name}>
                          {formatProfileDisplay(profile)}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__none__" disabled>
                        No profiles found
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
            </TabsContent>
            
            <TabsContent value="create" className="mt-0">
              <CreateProfileSection
                form={form}
                isSubmitting={isSubmitting}
              />
            </TabsContent>
          </Tabs>
        )}

        {form.formState.errors.mikrotikProfile && (
          <FieldDescription className="text-destructive">
            {form.formState.errors.mikrotikProfile.message}
          </FieldDescription>
        )}
      </Field>

      {/* Active Toggle */}
      <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
        <div className="space-y-0.5">
          <FieldLabel htmlFor="active" className="text-base">
            Active
          </FieldLabel>
          <FieldDescription>
            If off, plan won&apos;t show to customers
          </FieldDescription>
        </div>
        <Switch
          id="active"
          checked={form.watch("active")}
          onCheckedChange={(checked) => form.setValue("active", checked)}
          disabled={isSubmitting}
        />
      </div>

      {/* Same Credentials Toggle */}
      <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
        <div className="space-y-0.5">
          <FieldLabel htmlFor="sameCredentials" className="text-base">
            Username and password should be same
          </FieldLabel>
          <FieldDescription>
            If on, generated username and password will be identical
          </FieldDescription>
        </div>
        <Switch
          id="sameCredentials"
          checked={form.watch("sameCredentials")}
          onCheckedChange={(checked) => form.setValue("sameCredentials", checked)}
          disabled={isSubmitting}
        />
      </div>
    </div>
  );
}
