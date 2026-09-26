import { create } from "zustand";
import { persist } from "zustand/middleware";
import { TenantBillingPlan } from "@/types/schemas";

interface OnboardingState {
  // Form data
  businessName: string;
  slug: string;
  slugAvailable: boolean | null;
  billingPlan: TenantBillingPlan | null;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  accountVerified: boolean;
  // Navigation
  currentStep: number;
  isSubmitting: boolean;
  error: string | null;
  // Actions
  updateField: (field: string, value: unknown) => void;
  nextStep: () => void;
  prevStep: () => void;
  setIsSubmitting: (value: boolean) => void;
  setError: (error: string | null) => void;
  canProceedFromStep: (step: number) => boolean;
  reset: () => void;
}

const initialState = {
  businessName: "",
  slug: "",
  slugAvailable: null,
  billingPlan: null,
  bankCode: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
  accountVerified: false,
  currentStep: 1,
  isSubmitting: false,
  error: null,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,

      updateField: (field, value) =>
        set((state) => ({ ...state, [field]: value })),

      nextStep: () =>
        set((state) => ({
          currentStep: Math.min(state.currentStep + 1, 4),
        })),

      prevStep: () =>
        set((state) => ({
          currentStep: Math.max(state.currentStep - 1, 1),
        })),

      setIsSubmitting: (value) => set({ isSubmitting: value }),

      setError: (error) => set({ error }),

      canProceedFromStep: (step: number): boolean => {
        const state = get();
        switch (step) {
          case 1:
            return (
              state.businessName.trim().length >= 2 &&
              state.slug.length >= 3 &&
              state.slugAvailable === true
            );
          case 2:
            return state.billingPlan !== null;
          case 3:
            return state.accountVerified;
          default:
            return true;
        }
      },

      reset: () => set(initialState),
    }),
    {
      name: "onboarding-store",
      // Only persist form data and step
      // Do not persist isSubmitting or error
      partialize: (state) => ({
        businessName: state.businessName,
        slug: state.slug,
        slugAvailable: state.slugAvailable,
        billingPlan: state.billingPlan,
        bankCode: state.bankCode,
        bankName: state.bankName,
        accountNumber: state.accountNumber,
        accountName: state.accountName,
        accountVerified: state.accountVerified,
        currentStep: state.currentStep,
      }),
    }
  )
);
