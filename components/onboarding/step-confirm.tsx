"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { refreshSession } from "@/lib/session-client";
import { usePaystackInline } from "@/hooks/use-paystack";
import { MaskedValue } from "@/components/system/masked-value";
import { type OnboardingPlan } from "@/components/onboarding/types";

export function Step4Confirm({
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
              <MaskedValue value={state.accountNumber} />
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
