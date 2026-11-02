"use client";

import { useCallback, useEffect, useState } from "react";

const PAYSTACK_SCRIPT_SRC = "https://js.paystack.co/v2/inline.js";

declare global {
  interface Window {
    PaystackPop: {
      new (): {
        newTransaction: (config: Record<string, unknown>) => void;
        resumeTransaction: (
          accessCode: string,
          callbacks: PaystackResumeCallbacks
        ) => void;
      };
    };
  }
}

/** Callback names and payloads per @paystack/inline-js 2.x. */
export interface PaystackResumeCallbacks {
  onSuccess: (transaction: { id: number; reference: string; message: string }) => void;
  onCancel?: () => void;
  onError?: (error: { message: string }) => void;
}

/**
 * Loads the Paystack Inline v2 script once (shared across every mounted
 * caller) and exposes a `pay(config)` helper for opening the popup.
 */
export function usePaystackInline() {
  const [loaded, setLoaded] = useState(
    typeof window !== "undefined" && !!window.PaystackPop
  );

  useEffect(() => {
    if (loaded || typeof window === "undefined") return;

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${PAYSTACK_SCRIPT_SRC}"]`
    );

    if (existing) {
      if (window.PaystackPop) {
        setLoaded(true);
      } else {
        existing.addEventListener("load", () => setLoaded(true));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PAYSTACK_SCRIPT_SRC;
    script.async = true;
    script.onload = () => setLoaded(true);
    document.body.appendChild(script);
  }, [loaded]);

  const pay = useCallback((config: Record<string, unknown>) => {
    if (typeof window === "undefined" || !window.PaystackPop) {
      throw new Error("Payment is still loading. Please try again in a moment.");
    }
    const popup = new window.PaystackPop();
    popup.newTransaction(config);
  }, []);

  /**
   * Opens the popup on a transaction the server already created (voucher
   * purchases, via /api/purchase/initiate). The browser supplies nothing
   * but the access code, so it cannot change the amount, the split or who
   * the sale belongs to.
   */
  const resume = useCallback(
    (accessCode: string, callbacks: PaystackResumeCallbacks) => {
      if (typeof window === "undefined" || !window.PaystackPop) {
        throw new Error("Payment is still loading. Please try again in a moment.");
      }
      const popup = new window.PaystackPop();
      popup.resumeTransaction(accessCode, callbacks);
    },
    []
  );

  return { loaded, pay, resume };
}
