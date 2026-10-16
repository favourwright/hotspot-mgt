"use client";

import { useState, useEffect } from "react";
import { CircleCheck, Loader2, X } from "lucide-react";

import { useOnboardingStore } from "@/stores/onboarding-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { tenantUrl } from "@/lib/tenant-url";

export function Step1BusinessInfo({
  state,
  updateField,
  setError,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
  setError: (error: string | null) => void;
}) {
  const { currentStep } = useOnboardingStore();
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [slugCheckTimeout, setSlugCheckTimeout] = useState<NodeJS.Timeout | null>(null);

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .substring(0, 30);
  };

  const checkSlugAvailability = async (slug: string) => {
    if (slug.length < 3) {
      setSlugStatus("invalid");
      updateField("slugAvailable", false);
      return;
    }

    if (!/^[a-z0-9-]+$/.test(slug)) {
      setSlugStatus("invalid");
      updateField("slugAvailable", false);
      return;
    }

    setSlugStatus("checking");
    try {
      const response = await fetch(`/api/auth/check-slug?slug=${encodeURIComponent(slug)}`);
      const result = await response.json();

      if (result.success && result.data.available) {
        setSlugStatus("available");
        updateField("slugAvailable", true);
      } else {
        setSlugStatus("taken");
        updateField("slugAvailable", false);
      }
    } catch {
      setSlugStatus("idle");
      updateField("slugAvailable", false);
    }
  };

  // Re-checks availability when somebody arrives back on this step, and
  // deliberately **not** when the slug changes.
  //
  // `state.slug` and `checkSlugAvailability` are omitted on purpose, not by
  // oversight: typing is already handled by the debounced path in
  // handleSlugChange below, and adding them here would fire an unauthorised
  // API call - and the Firestore read behind it - on every keystroke,
  // alongside the debounce rather than instead of it.
  useEffect(() => {
    if (currentStep === 1 && state.slug.length >= 3) {
      checkSlugAvailability(state.slug);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const handleSlugChange = (value: string) => {
    updateField("slug", value);
    updateField("slugAvailable", null);
    setSlugStatus("idle");

    if (slugCheckTimeout) {
      clearTimeout(slugCheckTimeout);
    }

    const timeout = setTimeout(() => {
      checkSlugAvailability(value);
    }, 500);

    setSlugCheckTimeout(timeout);
  };

  const suggestedSlug = generateSlug(state.businessName);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="businessName">Business Name</Label>
        <Input
          id="businessName"
          value={state.businessName}
          onChange={(e) => updateField("businessName", e.target.value)}
          placeholder="e.g. Mama Nkechi's WiFi Spot"
        />
      </div>

      <div>
        <Label htmlFor="slug">Portal Slug</Label>
        {/* The availability check lives in the field's trailing addon, so
            the answer appears where the typing is rather than as a line
            that pushes the rest of the step down each time it changes. */}
        <InputGroup>
          <InputGroupInput
            id="slug"
            value={state.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="e.g. mama-nkechis-spot"
            aria-describedby="slug-status"
          />
          <InputGroupAddon align="inline-end">
            <span
              id="slug-status"
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-center gap-1.5 text-sm",
                (slugStatus === "taken" || slugStatus === "invalid") &&
                  "text-destructive"
              )}
            >
              {slugStatus === "checking" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {slugStatus === "available" && (
                <CircleCheck className="size-4 text-black" />
              )}
              {slugStatus === "taken" && (
                <X className="size-4" />
              )}
              {slugStatus === "invalid" && (
                <>
                  <X className="size-4" />
                  <span className="sr-only">
                    Only lowercase letters, numbers and hyphens
                  </span>
                </>
              )}
            </span>
          </InputGroupAddon>
        </InputGroup>
        <p className="mt-1 text-sm text-muted-foreground">
          {slugStatus === "invalid"
            ? "Only lowercase letters, numbers and hyphens."
            : `Your portal: ${tenantUrl(state.slug || "your-slug")}`}
        </p>
        {suggestedSlug && !state.slug && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-foreground"
            onClick={() => handleSlugChange(suggestedSlug)}
          >
            Suggested: {suggestedSlug}
          </Button>
        )}
      </div>
    </div>
  );
}
