"use client"

import { useState, useEffect } from "react"
import { AlertCircle, ArrowLeft } from "lucide-react"

import { useOnboardingStore } from "@/stores/onboarding-store"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Step1BusinessInfo } from "@/components/onboarding/step-business-info"
import { Step2ChoosePlan } from "@/components/onboarding/step-choose-plan"
import { Step3BankDetails } from "@/components/onboarding/step-bank-details"
import { Step4Confirm } from "@/components/onboarding/step-confirm"
import { type OnboardingPlan } from "@/components/onboarding/types"

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
  } = useOnboardingStore()

  const [plans, setPlans] = useState<OnboardingPlan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const response = await fetch("/api/onboarding/plans")
        const json = await response.json()
        if (json.success) {
          setPlans(json.data)
        }
      } catch (error) {
        console.error("Failed to fetch billing plans:", error)
      } finally {
        setPlansLoading(false)
      }
    }
    fetchPlans()
  }, [])

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>
          Welcome! Let's set up your hotspot business
        </SurfaceCardTitle>
        <SurfaceCardDescription>Step {currentStep} of 4</SurfaceCardDescription>
        <div className="mt-4 flex gap-2">
          {[1, 2, 3, 4].map((step) => {
            const isCompleted = step < currentStep
            const isClickable = isCompleted

            return (
              <button
                key={step}
                onClick={() => isClickable && goToStep(step)}
                disabled={!isClickable}
                aria-label={`Step ${step}`}
                className={`h-2 flex-1 rounded-full transition-colors ${
                  step <= currentStep ? "bg-foreground" : "bg-sunken"
                } ${isClickable ? "cursor-pointer hover:opacity-80" : ""}`}
              />
            )
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

        {/* Secondary first at its natural width, primary taking the rest --
            and stacking below md so neither gets squeezed on a phone. */}
        <div className="flex gap-2 max-md:flex-col">
          {currentStep > 1 && currentStep < 4 && (
            <Button variant="ghost" onClick={prevStep} disabled={isSubmitting}>
              <ArrowLeft />
              Back
            </Button>
          )}
          {currentStep < 4 && (
            <Button
              onClick={nextStep}
              disabled={!canProceedFromStep(currentStep)}
              className="md:flex-1"
            >
              Next
            </Button>
          )}
        </div>
      </SurfaceCardContent>
    </SurfaceCard>
  )
}
