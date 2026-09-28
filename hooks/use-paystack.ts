"use client";

import { useCallback, useEffect, useState } from "react";

const PAYSTACK_SCRIPT_SRC = "https://js.paystack.co/v2/inline.js";

declare global {
  interface Window {
    PaystackPop: {
      new (): {
        newTransaction: (config: Record<string, unknown>) => void;
      };
    };
  }
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
      throw new Error("Paystack is still loading. Please try again in a moment.");
    }
    const popup = new window.PaystackPop();
    popup.newTransaction(config);
  }, []);

  return { loaded, pay };
}
