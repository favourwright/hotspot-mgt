"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/providers/auth-provider";
import { useRouter } from "next/navigation";
import { refreshSession } from "@/lib/session-client";
import { forgetSignupReturn, leaveForCheckout, signupReturn } from "@/lib/checkout-return";
import { MaskedValue } from "@/components/system/masked-value";
import { type OnboardingPlan } from "@/components/onboarding/types";
import { tenantUrl } from "@/lib/tenant-url";

/** Where this tab keeps a signup payment's reference, so a reload does not lose it. */
const PAID_REFERENCE_KEY = "onboarding:payment-reference";

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
  const [preparingPayment, setPreparingPayment] = useState(false);
  // The first period's payment, once Monnify has brought this tab back from it. Kept for
  // the tab, so a reload after paying still finishes the signup with it.
  // Back from Monnify's checkout (/onboarding/paid/<reference>): that payment is now the
  // signup's.
  const [returned] = useState<string | null>(() => (typeof window === "undefined" ? null : signupReturn()));
  const [paidReference] = useState<string | null>(() =>
    typeof window === "undefined" ? null : returned ?? window.sessionStorage.getItem(PAID_REFERENCE_KEY)
  );
  // A code the server has said it would honour. Advisory only: create-tenant
  // re-validates and redeems it itself, so a tampered value here buys a
  // rejected signup, not a free account.
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    message: string;
    /** Server-computed. The browser never works out its own price. */
    payableKobo: number;
    /** The exact sum to charge, its fee already included. */
    chargeKobo: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const submitCreateTenant = async (paymentReference?: string) => {
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
          paymentReference,
          couponCode: appliedCoupon?.code,
        }),
      });

      const result = await response.json();

      if (result.success) {
        window.sessionStorage.removeItem(PAID_REFERENCE_KEY);
        // Refresh token to get new role/tenant (picked up by the
        // onIdTokenChanged listener in AuthProvider) and re-mint the session
        // cookie from it, so server components see "owner" too. Don't reset
        // the onboarding store here - /onboarding/complete still needs its
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

  const applyCoupon = async () => {
    setCheckingCoupon(true);
    setCouponError(null);
    try {
      const token = await user?.getIdToken();
      const response = await fetch("/api/onboarding/validate-coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: couponInput, planId: state.planId }),
      });
      const result = await response.json();

      if (result.success && result.data.valid) {
        setAppliedCoupon({
          code: couponInput.trim().toUpperCase(),
          message: result.data.message,
          payableKobo: result.data.payableKobo ?? 0,
          chargeKobo: result.data.chargeKobo ?? 0,
        });
      } else {
        setCouponError(result.data?.message || result.error || "That code isn't valid.");
      }
    } catch {
      setCouponError("Couldn't check that code. Try again.");
    } finally {
      setCheckingCoupon(false);
    }
  };

  const selectedPlan = plans.find((p) => p.id === state.planId) ?? null;
  const planMonthlyFee = selectedPlan?.monthlyFee ?? 0;
  const planTrialDays = selectedPlan?.trialDays ?? 0;
  // What the signup actually has to collect. A code governs when one is
  // applied, otherwise the plan's own trial does - the same precedence
  // create-tenant uses, which decides it again on its own. This only keeps
  // the button honest.
  const monthlyFee = appliedCoupon
    ? appliedCoupon.payableKobo
    : planTrialDays > 0
      ? 0
      : planMonthlyFee;

  // What the button says until the server answers with the real amount, which may add
  // the passed-on processing fee (docs/billing-and-payments.md).
  const [chargeAmount, setChargeAmount] = useState(
    appliedCoupon ? appliedCoupon.chargeKobo : monthlyFee
  );

  const handlePaidSubmit = async () => {
    if (!user?.email) return;
    setPreparingPayment(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/onboarding/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId: state.planId, slug: state.slug, couponCode: appliedCoupon?.code ?? null }),
      });
      const result = await response.json();
      if (!result.success || !result.data?.checkoutUrl) {
        setError(result.error || "Failed to prepare payment. Please try again.");
        return;
      }
      setChargeAmount(result.data.amount);
      // Monnify's checkout, full screen. It comes back to /onboarding/paid/<reference>,
      // and the effect below finishes the signup. Until then it is only started: a
      // checkout abandoned is not a payment to finish with.
      leaveForCheckout(result.data.checkoutUrl, result.data.reference, { kind: "signup" });
    } catch {
      setError("Failed to prepare payment. Please try again.");
      setPreparingPayment(false);
    }
  };

  // Finishes the signup with it, once: create-tenant checks it with the gateway.
  useEffect(() => {
    if (!returned) return;
    forgetSignupReturn();
    window.sessionStorage.setItem(PAID_REFERENCE_KEY, returned);
    void submitCreateTenant(returned);
    // Once, on the way back in; submitCreateTenant reads the store as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
              {tenantUrl(state.slug)}
            </div>
          </div>

          <div>
            <div className="text-muted-foreground">Billing Plan</div>
            <div className="font-medium">{selectedPlan?.name}</div>
            <div className="text-sm text-muted-foreground">{selectedPlan?.description}</div>
          </div>

          {/* Only shown when there is a fee to waive. On a commission-only
              plan a code would change nothing, and offering one would be
              inviting people to hunt for something that does not exist. */}
          {planTrialDays > 0 && planMonthlyFee > 0 && (
            <div>
              <div className="text-muted-foreground">Trial</div>
              <div className="font-medium">
                First {planTrialDays} days free
              </div>
              <div className="text-sm text-muted-foreground">
                Your {selectedPlan?.name} fee starts after that.
              </div>
            </div>
          )}

          {planMonthlyFee > 0 && (
            <div>
              <div className="text-muted-foreground">Promo code</div>
              {appliedCoupon ? (
                <div className="mt-1 text-sm">
                  <span className="font-medium font-mono">
                    {appliedCoupon.code}
                  </span>{" "}
                  applied. {appliedCoupon.message}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setAppliedCoupon(null);
                      setCouponInput("");
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="mt-1 flex gap-2">
                    <Input
                      value={couponInput}
                      onChange={(e) =>
                        setCouponInput(e.target.value.toUpperCase())
                      }
                      placeholder="Optional"
                      className="font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={checkingCoupon || couponInput.trim().length < 3}
                      onClick={applyCoupon}
                    >
                      {checkingCoupon ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                  {couponError && (
                    <p className="mt-1 text-xs text-destructive">
                      {couponError}
                    </p>
                  )}
                </>
              )}
            </div>
          )}

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

      {/* Paid, but the account was not made (a slip in the network, or the payment not
          through yet): finish with the same payment, never pay again. */}
      {paidReference && monthlyFee > 0 && (
        <Button
          onClick={() => submitCreateTenant(paidReference)}
          disabled={isSubmitting}
          className="w-full"
          size="lg"
        >
          {isSubmitting ? "Setting up your account..." : "I've paid: finish setting up"}
        </Button>
      )}

      {!(paidReference && monthlyFee > 0) && (
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
          `Pay ₦${(chargeAmount / 100).toLocaleString()} & Activate Account`
        ) : (
          "Create My Account"
        )}
      </Button>
      )}
    </div>
  );
}
