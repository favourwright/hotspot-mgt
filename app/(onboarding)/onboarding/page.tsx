"use client";

import { useOnboardingStore } from "@/stores/onboarding-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { Check, Loader2, AlertCircle, X } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { TenantBillingPlan, DEFAULT_BILLING_PLAN_CONFIG, BillingPlanConfigItem } from "@/types/schemas";
import { PaystackBank } from "@/lib/paystack";

export default function OnboardingPage() {
  const {
    currentStep,
    nextStep,
    prevStep,
    goToStep,
    canProceedFromStep,
    isSubmitting,
    setIsSubmitting,
    error,
    setError,
    updateField,
    reset,
    ...state
  } = useOnboardingStore();

  const [platformConfig, setPlatformConfig] = useState<
    Record<string, BillingPlanConfigItem>
  >(DEFAULT_BILLING_PLAN_CONFIG);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/platform/config");
        const json = await response.json();
        if (json.success) {
          setPlatformConfig(json.data.billingPlans);
        }
      } catch (error) {
        console.error("Failed to fetch platform config:", error);
        // Keep using DEFAULT_BILLING_PLAN_CONFIG
      }
    };
    fetchConfig();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome! Let's set up your hotspot business</CardTitle>
        <CardDescription>
          Step {currentStep} of 4
        </CardDescription>
        <div className="flex gap-2 mt-4">
          {[1, 2, 3, 4].map((step) => {
            const isCompleted = step < currentStep;
            const isClickable = isCompleted;
            
            return (
              <button
                key={step}
                onClick={() => isClickable && goToStep(step)}
                disabled={!isClickable}
                className={`h-2 flex-1 rounded-full ${
                  step <= currentStep ? "bg-primary" : "bg-muted"
                } ${isClickable ? "cursor-pointer hover:opacity-80" : ""}`}
              />
            );
          })}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <span className="ml-2">{error}</span>
          </Alert>
        )}

        {currentStep === 1 && (
          <Step1BusinessInfo
            state={state}
            updateField={updateField}
            setError={setError}
          />
        )}

        {currentStep === 2 && (
          <Step2ChoosePlan
            state={state}
            updateField={updateField}
          />
        )}

        {currentStep === 3 && (
          <Step3BankDetails
            state={state}
            updateField={updateField}
            setError={setError}
          />
        )}

        {currentStep === 4 && (
          <Step4Confirm
            state={state}
            isSubmitting={isSubmitting}
            setIsSubmitting={setIsSubmitting}
            setError={setError}
            reset={reset}
            platformConfig={platformConfig}
          />
        )}

        <div className="flex gap-2">
          {currentStep > 1 && currentStep < 4 && (
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={isSubmitting}
            >
              Back
            </Button>
          )}
          {currentStep < 4 && (
            <Button
              onClick={nextStep}
              disabled={!canProceedFromStep(currentStep)}
              className="ml-auto"
            >
              Next
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Step1BusinessInfo({
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

  useEffect(() => {
    if (currentStep === 1 && state.slug.length >= 3) {
      checkSlugAvailability(state.slug);
    }
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
          placeholder="e.g. Joel's WiFi Hub"
        />
      </div>

      <div>
        <Label htmlFor="slug">Portal Slug</Label>
        <Input
          id="slug"
          value={state.slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="e.g. joels-hub"
        />
        <p className="text-sm text-muted-foreground mt-1">
          Your portal: {process.env.NEXT_PUBLIC_APP_URL || "myapp.com"}/{state.slug || "your-slug"}
        </p>
        {suggestedSlug && !state.slug && (
          <Button
            variant="link"
            size="sm"
            className="px-0 h-auto"
            onClick={() => handleSlugChange(suggestedSlug)}
          >
            Suggested: {suggestedSlug}
          </Button>
        )}
        {slugStatus === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking availability...
          </div>
        )}
        {slugStatus === "available" && (
          <div className="flex items-center gap-2 text-sm text-green-600 mt-2">
            <Check className="h-4 w-4" />
            Available
          </div>
        )}
        {slugStatus === "taken" && (
          <div className="flex items-center gap-2 text-sm text-destructive mt-2">
            <X className="h-4 w-4" />
            Already taken
          </div>
        )}
        {slugStatus === "invalid" && (
          <div className="flex items-center gap-2 text-sm text-destructive mt-2">
            <X className="h-4 w-4" />
            Only lowercase letters, numbers, and hyphens
          </div>
        )}
      </div>
    </div>
  );
}

function Step2ChoosePlan({
  state,
  updateField,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
}) {
  const [platformConfig, setPlatformConfig] = useState<
    Record<string, BillingPlanConfigItem>
  >(DEFAULT_BILLING_PLAN_CONFIG);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/platform/config");
        const json = await response.json();
        if (json.success) {
          setPlatformConfig(json.data.billingPlans);
        }
      } catch (error) {
        console.error("Failed to fetch platform config:", error);
        // Keep using DEFAULT_BILLING_PLAN_CONFIG
      } finally {
        setConfigLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const plans: Array<{
    id: TenantBillingPlan;
    config: BillingPlanConfigItem;
    features: Array<{ text: string; included: boolean }>;
  }> = [
    {
      id: "pay-per-transaction",
      config: platformConfig["pay-per-transaction"],
      features: [
        { text: "No monthly commitment", included: true },
        { text: "Pay only when you earn", included: true },
        { text: "Higher per-transaction fee", included: false },
      ],
    },
    {
      id: "subscription-only",
      config: platformConfig["subscription-only"],
      features: [
        { text: "Lowest total cost at volume", included: true },
        { text: "Keep all voucher revenue", included: true },
        { text: "Monthly fee regardless of sales", included: false },
      ],
    },
    {
      id: "hybrid",
      config: platformConfig["hybrid"],
      features: [
        { text: "Lower monthly fee", included: true },
        { text: "Reduced per-transaction fee", included: true },
        { text: "Best for growing businesses", included: true },
      ],
    },
  ];

  if (configLoading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Choose Your Billing Plan</h3>
        <p className="text-sm text-muted-foreground">
          You can change this later from your dashboard
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => updateField("billingPlan", plan.id)}
            className={`p-4 border-2 rounded-lg text-left transition-all ${
              state.billingPlan === plan.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold">{plan.config.label}</h4>
              {state.billingPlan === plan.id && (
                <Check className="h-5 w-5 text-primary" />
              )}
            </div>
            <div className="text-2xl font-bold mb-1">
              {plan.config.monthlyFee === 0
                ? "Free"
                : `₦${(plan.config.monthlyFee / 100).toLocaleString()}`}
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              {plan.config.platformFeePercent}% per transaction
            </div>
            <p className="text-sm mb-4">{plan.config.description}</p>
            <div className="space-y-2">
              {plan.features.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  {feature.included ? (
                    <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <X className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                  <span className={feature.included ? "" : "text-muted-foreground"}>
                    {feature.text}
                  </span>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Step3BankDetails({
  state,
  updateField,
  setError,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
  setError: (error: string | null) => void;
}) {
  const [banks, setBanks] = useState<PaystackBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    fetchBanks();
  }, []);

  const fetchBanks = async () => {
    try {
      const response = await fetch("/api/onboarding/banks");
      const result = await response.json();
      if (result.success) {
        setBanks(result.data);
      }
    } catch {
      setError("Failed to load banks");
    } finally {
      setLoadingBanks(false);
    }
  };

  const { user } = useAuth();

  const handleVerifyAccount = async () => {
    if (!state.bankCode || state.accountNumber.length !== 10) return;

    setVerifying(true);
    setError(null);

    try {
      const token = await user?.getIdToken();

      const response = await fetch("/api/onboarding/verify-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountNumber: state.accountNumber,
          bankCode: state.bankCode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        updateField("accountName", result.data.accountName);
        updateField("accountVerified", true);
      } else {
        setError(result.error || "Failed to verify account");
        updateField("accountVerified", false);
      }
    } catch {
      setError("Failed to verify account");
      updateField("accountVerified", false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Bank Account Details</h3>
        <p className="text-sm text-muted-foreground">
          Customer payments will be sent directly to this account
        </p>
      </div>

      <div>
        <Label htmlFor="bank">Bank</Label>
        {loadingBanks ? (
          <div className="flex items-center gap-2 h-10 px-3 border rounded">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Loading banks...</span>
          </div>
        ) : (
          <select
            id="bank"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={state.bankCode}
            onChange={(e) => {
              const selectedBank = banks.find((b) => b.code === e.target.value);
              updateField("bankCode", e.target.value);
              updateField("bankName", selectedBank?.name || "");
              updateField("accountVerified", false);
              updateField("accountName", "");
            }}
          >
            <option value="">Select a bank</option>
            {banks
              .filter(
                (bank, index, self) =>
                  index === self.findIndex((b) => b.code === bank.code)
              )
              .map((bank) => (
                <option key={`${bank.code}-${bank.slug}`} value={bank.code}>
                  {bank.name}
                </option>
              ))}
          </select>
        )}
      </div>

      <div>
        <Label htmlFor="accountNumber">Account Number</Label>
        <Input
          id="accountNumber"
          type="text"
          inputMode="numeric"
          maxLength={10}
          value={state.accountNumber}
          onChange={(e) => {
            const value = e.target.value.replace(/\D/g, "");
            updateField("accountNumber", value);
            updateField("accountVerified", false);
            updateField("accountName", "");
          }}
          placeholder="0123456789"
        />
      </div>

      <Button
        onClick={handleVerifyAccount}
        disabled={!state.bankCode || state.accountNumber.length !== 10 || verifying}
      >
        {verifying ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Verifying...
          </>
        ) : (
          "Verify Account"
        )}
      </Button>

      {state.accountVerified && state.accountName && (
        <Alert className="border-green-600 bg-green-50">
          <Check className="h-4 w-4 text-green-600" />
          <div className="ml-2">
            <div className="font-semibold">Account Verified</div>
            <div className="text-sm">{state.accountName}</div>
          </div>
        </Alert>
      )}
    </div>
  );
}

function Step4Confirm({
  state,
  isSubmitting,
  setIsSubmitting,
  setError,
  reset,
  platformConfig,
}: {
  state: any;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
  platformConfig: Record<TenantBillingPlan, BillingPlanConfigItem>;
}) {
  const router = useRouter();
  const { user } = useAuth();

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const token = await user?.getIdToken();

      const response = await fetch("/api/onboarding/create-tenant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          businessName: state.businessName,
          slug: state.slug,
          billingPlan: state.billingPlan,
          accountNumber: state.accountNumber,
          bankCode: state.bankCode,
          bankName: state.bankName,
          accountName: state.accountName,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh token to get new role
        await user?.getIdToken(true);
        reset();
        router.push("/onboarding/complete");
      } else {
        setError(result.error || "Failed to create account");
      }
    } catch {
      setError("Failed to create account");
    } finally {
      setIsSubmitting(false);
    }
  };

  const planConfig = state.billingPlan
    ? (platformConfig[state.billingPlan as TenantBillingPlan] || DEFAULT_BILLING_PLAN_CONFIG[state.billingPlan as TenantBillingPlan])
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold mb-4">Review & Confirm</h3>

        <div className="space-y-4 text-sm">
          <div>
            <div className="text-muted-foreground">Business Name</div>
            <div className="font-medium">{state.businessName}</div>
          </div>

          <div>
            <div className="text-muted-foreground">Portal URL</div>
            <div className="font-medium">
              {process.env.NEXT_PUBLIC_APP_URL || "myapp.com"}/{state.slug}
            </div>
          </div>

          <div>
            <div className="text-muted-foreground">Billing Plan</div>
            <div className="font-medium">{planConfig?.label}</div>
            <div className="text-sm text-muted-foreground">{planConfig?.description}</div>
          </div>

          <div>
            <div className="text-muted-foreground">Bank Account</div>
            <div className="font-medium">{state.bankName}</div>
            <div className="text-sm">
              {state.accountNumber.slice(0, -4).replace(/\d/g, "*")}
              {state.accountNumber.slice(-4)}
            </div>
            <div className="text-sm">{state.accountName}</div>
          </div>
        </div>
      </div>

      <Button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Setting up your account...
          </>
        ) : (
          "Create My Account"
        )}
      </Button>
    </div>
  );
}
