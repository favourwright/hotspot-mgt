"use client";

import { useEffect } from "react";
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
import { Loader2, AlertCircle, ChevronDown } from "lucide-react";
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
  dataLimitUnlimited: boolean;
  mikrotikProfile: string;
  active: boolean;
  sameCredentials: boolean;
  // Duration fields
  durationValue: number;
  durationUnit: "hours" | "days";
  // Data limit fields
  dataLimitValue?: number;
  dataLimitUnit: "MB" | "GB";
  // New profile fields (only used when creating new profile)
  newProfileName: string;
  newProfileRateLimit: string;
  newProfileRateLimitUpload?: number;
  newProfileRateLimitDownload?: number;
  newProfileRateLimitUnit: "Kbps" | "Mbps";
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

const DURATION_UNITS = ["hours", "days"] as const;
const DATA_LIMIT_UNITS = ["MB", "GB"] as const;
const RATE_LIMIT_UNITS = ["Kbps", "Mbps"] as const;

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
  const selectedProfile = form.watch("mikrotikProfile");
  const newProfileName = form.watch("newProfileName");
  const durationValue = form.watch("durationValue");
  const durationUnit = form.watch("durationUnit");
  const dataLimitUnlimited = form.watch("dataLimitUnlimited");
  const dataLimitValue = form.watch("dataLimitValue");
  const dataLimitUnit = form.watch("dataLimitUnit");

  const {
    data: profiles,
    isLoading: profilesLoading,
    error: profilesError,
    refetch: refetchProfiles,
  } = useProfiles(selectedLocationId || null);

  // Calculate duration and routerDuration from value + unit
  useEffect(() => {
    if (durationValue && durationUnit) {
      if (durationUnit === "hours") {
        const days = Math.floor(durationValue / 24);
        const hours = durationValue % 24;
        
        if (days > 0 && hours === 0) {
          form.setValue("duration", `${days} ${days === 1 ? 'day' : 'days'}`);
          form.setValue("routerDuration", `${days}d`);
        } else if (days > 0 && hours > 0) {
          form.setValue("duration", `${days}d ${hours}h`);
          form.setValue("routerDuration", `${durationValue}h`);
        } else {
          form.setValue("duration", `${durationValue} ${durationValue === 1 ? 'hour' : 'hours'}`);
          form.setValue("routerDuration", `${durationValue}h`);
        }
      } else {
        form.setValue("duration", `${durationValue} ${durationValue === 1 ? 'day' : 'days'}`);
        form.setValue("routerDuration", `${durationValue}d`);
      }
    }
  }, [durationValue, durationUnit, form]);

  // Calculate dataLimit from value + unit
  useEffect(() => {
    if (dataLimitUnlimited) {
      form.setValue("dataLimit", "Unlimited");
    } else if (dataLimitValue && dataLimitUnit) {
      form.setValue("dataLimit", `${dataLimitValue}${dataLimitUnit}`);
    }
  }, [dataLimitUnlimited, dataLimitValue, dataLimitUnit, form]);

  // Auto-fill plan name when profile is selected
  useEffect(() => {
    if (profileTab === "select" && selectedProfile) {
      // Only auto-fill if plan name is empty or matches previous profile name
      const currentPlanName = form.getValues("name");
      if (!currentPlanName || profiles?.some(p => p.name === currentPlanName)) {
        form.setValue("name", selectedProfile);
      }
    }
  }, [selectedProfile, profileTab, form, profiles]);

  // Auto-fill plan name when creating new profile
  useEffect(() => {
    if (profileTab === "create" && newProfileName) {
      // Only auto-fill if plan name is empty or matches previous new profile name
      form.setValue("name", newProfileName);
    }
  }, [newProfileName, profileTab, form]);

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
                  value={form.watch("mikrotikProfile") || ""}
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

      {/* Plan Name Field */}
      <Field>
        <FieldLabel htmlFor="name">Plan Name *</FieldLabel>
        <Input
          id="name"
          placeholder="e.g., 1 Hour Browsing"
          {...form.register("name")}
          disabled={isSubmitting}
        />
        <FieldDescription>
          Auto-filled from profile name, but you can customize it for customers
        </FieldDescription>
        {form.formState.errors.name && (
          <FieldDescription className="text-destructive">
            {form.formState.errors.name.message}
          </FieldDescription>
        )}
      </Field>

      {/* Price, Duration, and Data Limit in Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          {form.formState.errors.price && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.price.message}
            </FieldDescription>
          )}
        </Field>

        {/* Duration Field */}
        <Field>
          <FieldLabel htmlFor="durationValue">Duration *</FieldLabel>
          <InputGroup>
            <InputGroupInput
              id="durationValue"
              type="number"
              min="1"
              max={durationUnit === "hours" ? "720" : "30"}
              placeholder="24"
              {...form.register("durationValue", { valueAsNumber: true })}
              disabled={isSubmitting}
            />
            <InputGroupAddon align="inline-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <InputGroupButton variant="ghost" className="pr-1.5! text-xs">
                      {durationUnit || "hours"} <ChevronDown className="size-3" />
                    </InputGroupButton>
                  }
                />
                <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4}>
                  {DURATION_UNITS.map((unit) => (
                    <DropdownMenuItem
                      key={unit}
                      onClick={() => form.setValue("durationUnit", unit)}
                    >
                      {unit}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </InputGroupAddon>
          </InputGroup>
          {form.formState.errors.durationValue && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.durationValue.message}
            </FieldDescription>
          )}
        </Field>

        {/* Data Limit Field */}
        <Field>
          <FieldLabel htmlFor="dataLimitValue">Data Limit</FieldLabel>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Switch
                id="dataLimitUnlimited"
                checked={dataLimitUnlimited}
                onCheckedChange={(checked) => form.setValue("dataLimitUnlimited", checked)}
                disabled={isSubmitting}
              />
              <FieldLabel htmlFor="dataLimitUnlimited" className="text-sm font-normal">
                Unlimited
              </FieldLabel>
            </div>
            {!dataLimitUnlimited && (
              <InputGroup>
                <InputGroupInput
                  id="dataLimitValue"
                  type="number"
                  min="1"
                  max={dataLimitUnit === "GB" ? "1000" : "1000000"}
                  placeholder="10"
                  {...form.register("dataLimitValue", { valueAsNumber: true })}
                  disabled={isSubmitting}
                />
                <InputGroupAddon align="inline-end">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <InputGroupButton variant="ghost" className="pr-1.5! text-xs">
                          {dataLimitUnit || "GB"} <ChevronDown className="size-3" />
                        </InputGroupButton>
                      }
                    />
                    <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4}>
                      {DATA_LIMIT_UNITS.map((unit) => (
                        <DropdownMenuItem
                          key={unit}
                          onClick={() => form.setValue("dataLimitUnit", unit)}
                        >
                          {unit}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </InputGroupAddon>
              </InputGroup>
            )}
          </div>
          {form.formState.errors.dataLimitValue && (
            <FieldDescription className="text-destructive">
              {form.formState.errors.dataLimitValue.message}
            </FieldDescription>
          )}
        </Field>
      </div>

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
