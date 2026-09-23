"use client";

import { UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
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
import { Loader2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useProfiles } from "@/hooks/use-profiles";
import { Location, MikrotikProfile } from "@/types/schemas";
import { CreateProfileSection } from "./create-profile-section";
import { useState } from "react";

export interface PlanFormData {
  locationId: string;
  locationName: string;
  name: string;
  price: number;
  duration: string;
  dataLimit: string;
  mikrotikProfile: string;
  active: boolean;
}

interface PlanFormFieldsProps {
  form: UseFormReturn<PlanFormData>;
  locations: Location[];
  isSubmitting: boolean;
  locationReadOnly?: boolean;
}

const DURATION_OPTIONS = [
  { value: "1 hour", label: "1 hour" },
  { value: "2 hours", label: "2 hours" },
  { value: "3 hours", label: "3 hours" },
  { value: "6 hours", label: "6 hours" },
  { value: "12 hours", label: "12 hours" },
  { value: "24 hours", label: "24 hours" },
  { value: "2 days", label: "2 days" },
  { value: "3 days", label: "3 days" },
  { value: "7 days", label: "7 days" },
  { value: "30 days", label: "30 days" },
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
}: PlanFormFieldsProps) {
  const [showCreateProfile, setShowCreateProfile] = useState(false);
  
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
    }
  };

  const handleProfileCreated = (profile: MikrotikProfile) => {
    form.setValue("mikrotikProfile", profile.name);
    setShowCreateProfile(false);
    refetchProfiles();
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
    <div className="space-y-4">
      {/* Location Field */}
      <div className="space-y-2">
        <Label htmlFor="locationId">Location *</Label>
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
          <p className="text-sm text-destructive">
            {form.formState.errors.locationId.message}
          </p>
        )}
      </div>

      {/* Plan Name Field */}
      <div className="space-y-2">
        <Label htmlFor="name">Plan Name *</Label>
        <Input
          id="name"
          placeholder="e.g., 1 Hour Browsing"
          {...form.register("name")}
          disabled={isSubmitting}
        />
        {form.formState.errors.name && (
          <p className="text-sm text-destructive">
            {form.formState.errors.name.message}
          </p>
        )}
      </div>

      {/* Price Field */}
      <div className="space-y-2">
        <Label htmlFor="price">Price (₦) *</Label>
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
          <p className="text-xs text-muted-foreground">
            {formatPriceDisplay(priceNaira * 100)}
          </p>
        )}
        {form.formState.errors.price && (
          <p className="text-sm text-destructive">
            {form.formState.errors.price.message}
          </p>
        )}
      </div>

      {/* Duration Field */}
      <div className="space-y-2">
        <Label htmlFor="duration">Duration *</Label>
        <Select
          value={form.watch("duration") || undefined}
          onValueChange={(value) => value && form.setValue("duration", value)}
          disabled={isSubmitting}
        >
          <SelectTrigger id="duration">
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.formState.errors.duration && (
          <p className="text-sm text-destructive">
            {form.formState.errors.duration.message}
          </p>
        )}
      </div>

      {/* Data Limit Field */}
      <div className="space-y-2">
        <Label htmlFor="dataLimit">Data Limit *</Label>
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
          <p className="text-sm text-destructive">
            {form.formState.errors.dataLimit.message}
          </p>
        )}
      </div>

      {/* MikroTik Profile Field */}
      <div className="space-y-2">
        <Label htmlFor="mikrotikProfile">MikroTik Profile *</Label>
        
        {!selectedLocationId ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please select a location first to load profiles
            </AlertDescription>
          </Alert>
        ) : profilesLoading ? (
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
              <span>Could not fetch profiles from router. Check that the location&apos;s router is online.</span>
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
            <SelectTrigger id="mikrotikProfile">
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

        {form.formState.errors.mikrotikProfile && (
          <p className="text-sm text-destructive">
            {form.formState.errors.mikrotikProfile.message}
          </p>
        )}

        {/* Create Profile Button/Section */}
        {selectedLocationId && (
          <div className="mt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowCreateProfile(!showCreateProfile)}
              className="h-auto p-0 text-sm font-normal text-primary hover:bg-transparent"
            >
              {showCreateProfile ? (
                <>
                  <ChevronUp className="mr-1 h-3 w-3" />
                  Hide Profile Creation
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-3 w-3" />
                  + Create New Profile on Router
                </>
              )}
            </Button>

            {showCreateProfile && (
              <CreateProfileSection
                locationId={selectedLocationId}
                onSuccess={handleProfileCreated}
                onCancel={() => setShowCreateProfile(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Active Toggle */}
      <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="active" className="text-base">
            Active
          </Label>
          <p className="text-sm text-muted-foreground">
            If off, plan won&apos;t show to customers
          </p>
        </div>
        <Switch
          id="active"
          checked={form.watch("active")}
          onCheckedChange={(checked) => form.setValue("active", checked)}
          disabled={isSubmitting}
        />
      </div>
    </div>
  );
}
