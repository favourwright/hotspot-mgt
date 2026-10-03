// Trimmed, public-safe shape returned by GET /api/onboarding/plans —
// mirrors the subset of BillingPlan exposed there (no Paystack codes/timestamps).
export interface OnboardingPlan {
  id: string
  name: string
  description: string
  billingModel: "flat" | "usage" | "hybrid" | "free"
  monthlyFee: number
  platformFeePercent: number
  transactionFeeFlat: number
  billingInterval: "monthly" | "yearly"
  trialDays: number
  limits: {
    maxLocations: number | null
    maxRouters: number | null
    maxCustomers: number | null
  }
  featureList: string[]
  badge: string | null
  sortOrder: number
}

/** The wizard's shared store slice, threaded through every step. */
export interface StepProps {
  state: any
  updateField: (field: string, value: unknown) => void
  setError: (error: string | null) => void
}
