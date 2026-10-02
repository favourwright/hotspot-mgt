import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OnboardingState {
  // Form data
  businessName: string;
  slug: string;
  slugAvailable: boolean | null;
  planId: string | null;
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
  goToStep: (step: number) => void;
  setIsSubmitting: (value: boolean) => void;
  setError: (error: string | null) => void;
  canProceedFromStep: (step: number) => boolean;
  reset: () => void;
}

const initialState = {
  businessName: "",
  slug: "",
  slugAvailable: null,
  planId: null,
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

      goToStep: (step: number) =>
        set((state) => {
          // Only allow going back to completed steps
          if (step >= state.currentStep) return state;

          // When going back to step 1, reset slug
          // availability status but keep the text values
          if (step === 1) {
            return {
              ...state,
              currentStep: step,
              slugAvailable: null,
            };
          }

          // When going back to step 3, reset account
          // verification so user must re-verify if they
          // change anything
          if (step === 3) {
            return {
              ...state,
              currentStep: step,
              accountVerified: false,
              accountName: "",
            };
          }

          // For step 2, just navigate — no resets needed
          return {
            ...state,
            currentStep: step,
          };
        }),

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
            return state.planId !== null;
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
        planId: state.planId,
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
