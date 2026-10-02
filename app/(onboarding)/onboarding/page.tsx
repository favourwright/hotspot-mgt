"use client";

import { useOnboardingStore } from "@/stores/onboarding-store";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { Check, Loader2, AlertCircle, X } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { refreshSession } from "@/lib/session-client";
import { PaystackBank } from "@/lib/paystack";
import { usePaystackInline } from "@/hooks/use-paystack";

// Trimmed, public-safe shape returned by GET /api/onboarding/plans —
// mirrors the subset of BillingPlan exposed there (no Paystack codes/timestamps).
interface OnboardingPlan {
  id: string;
  name: string;
  description: string;
  billingModel: "flat" | "usage" | "hybrid" | "free";
  monthlyFee: number;
  platformFeePercent: number;
  transactionFeeFlat: number;
  billingInterval: "monthly" | "yearly";
  trialDays: number;
  limits: {
    maxLocations: number | null;
    maxRouters: number | null;
    maxCustomers: number | null;
  };
  featureList: string[];
  badge: string | null;
  sortOrder: number;
}

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
    reset: _reset, // excluded so it doesn't leak into ...state below
    ...state
  } = useOnboardingStore();

  const [plans, setPlans] = useState<OnboardingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const response = await fetch("/api/onboarding/plans");
        const json = await response.json();
        if (json.success) {
          setPlans(json.data);
        }
      } catch (error) {
        console.error("Failed to fetch billing plans:", error);
      } finally {
        setPlansLoading(false);
      }
    };
    fetchPlans();
  }, []);

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Welcome! Let's set up your hotspot business</SurfaceCardTitle>
        <SurfaceCardDescription>
          Step {currentStep} of 4
        </SurfaceCardDescription>
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
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-6">
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
            plans={plans}
            plansLoading={plansLoading}
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
            plans={plans}
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
      </SurfaceCardContent>
    </SurfaceCard>
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
          <div className="flex items-center gap-2 text-sm text-emerald-600 mt-2">
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
  plans,
  plansLoading,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
  plans: OnboardingPlan[];
  plansLoading: boolean;
}) {
  if (plansLoading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="ml-2">No billing plans are available right now. Please contact support.</span>
      </Alert>
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
            onClick={() => updateField("planId", plan.id)}
            className={`p-4 border-2 rounded-lg text-left transition-all ${
              state.planId === plan.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold">{plan.name}</h4>
              {state.planId === plan.id && (
                <Check className="h-5 w-5 text-primary" />
              )}
            </div>
            {plan.badge && (
              <Badge variant="secondary" className="mb-2 text-xs">
                {plan.badge}
              </Badge>
            )}
            <div className="text-2xl font-bold mb-1">
              {plan.monthlyFee === 0
                ? "Free"
                : `₦${(plan.monthlyFee / 100).toLocaleString()}/${plan.billingInterval === "yearly" ? "yr" : "mo"}`}
            </div>
            {plan.platformFeePercent > 0 && (
              <div className="text-sm text-muted-foreground mb-3">
                {plan.platformFeePercent}% per transaction
              </div>
            )}
            <p className="text-sm mb-4">{plan.description}</p>
            <div className="space-y-2">
              {plan.featureList.map((feature, idx) => (
                <div key={idx} className="flex items-start gap-2 text-sm">
                  <Check className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <span>{feature}</span>
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
        <Alert className="border-emerald-600 bg-emerald-50">
          <Check className="h-4 w-4 text-emerald-600" />
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
  plans,
}: {
  state: any;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  setError: (error: string | null) => void;
  plans: OnboardingPlan[];
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { pay } = usePaystackInline();
  const [preparingPayment, setPreparingPayment] = useState(false);

  const submitCreateTenant = async (paystackReference?: string) => {
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
          planId: state.planId,
          accountNumber: state.accountNumber,
          bankCode: state.bankCode,
          bankName: state.bankName,
          accountName: state.accountName,
          paystackReference,
        }),
      });

      const result = await response.json();

      if (result.success) {
        // Refresh token to get new role/tenant (picked up by the
        // onIdTokenChanged listener in AuthProvider) and re-mint the session
        // cookie from it, so server components see "owner" too. Don't reset
        // the onboarding store here — /onboarding/complete still needs its
        // `slug` as a fallback while the real tenant object loads; it
        // resets the store itself once the user navigates away.
        await refreshSession();
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

  const selectedPlan = plans.find((p) => p.id === state.planId) ?? null;
  const monthlyFee = selectedPlan?.monthlyFee ?? 0;

  const handlePaidSubmit = async () => {
    if (!user?.email) return;

    setPreparingPayment(true);
    setError(null);

    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/onboarding/plan-code?planId=${state.planId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const result = await response.json();

      if (!result.success || !result.data?.planCode) {
        setError(result.error || "Failed to prepare payment. Please try again.");
        return;
      }

      pay({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: user.email,
        amount: monthlyFee,
        plan: result.data.planCode,
        onSuccess: (transaction: { reference: string }) =>
          submitCreateTenant(transaction.reference),
        onCancel: () => {
          // User closed the payment popup — let them retry.
        },
        onError: (err: { message: string }) => {
          setError(err.message || "Payment failed. Please try again.");
        },
      });
    } catch {
      setError("Failed to prepare payment. Please try again.");
    } finally {
      setPreparingPayment(false);
    }
  };

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
            <div className="font-medium">{selectedPlan?.name}</div>
            <div className="text-sm text-muted-foreground">{selectedPlan?.description}</div>
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
        onClick={monthlyFee > 0 ? handlePaidSubmit : () => submitCreateTenant()}
        disabled={isSubmitting || preparingPayment}
        className="w-full"
        size="lg"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Setting up your account...
          </>
        ) : preparingPayment ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparing payment...
          </>
        ) : monthlyFee > 0 ? (
          `Pay ₦${(monthlyFee / 100).toLocaleString()} & Activate Account`
        ) : (
          "Create My Account"
        )}
      </Button>
    </div>
  );
}
