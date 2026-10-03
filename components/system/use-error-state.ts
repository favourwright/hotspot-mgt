"use client";

import { useCallback, useState } from "react";

import { toast } from "@/components/ui/toast";

/**
 * Error state that also surfaces a toast.
 *
 * A drop-in replacement for `useState("")` on an error field: setting a
 * message both renders the inline alert and raises a toast, while clearing
 * it (`""` or `null`) does neither. Wrapping the setter rather than every
 * call site means existing `setError(...)` calls gain the toast for free.
 *
 * Both are worth having. The inline alert is anchored to the form that
 * failed and persists while the user fixes it; the toast catches the case
 * where the alert is scrolled out of view -- which is most of the time in
 * a long dialog.
 */
export function useErrorState(
  title = "Something went wrong"
): [string, (message: string | null, toastDescription?: string) => void] {
  const [error, setErrorState] = useState("");

  const setError = useCallback(
    /**
     * `toastDescription` is for messages that are long on purpose -- a
     * diagnostic with instructions reads well in the inline alert and
     * badly in a toast, so the caller can pass a one-line summary instead.
     */
    (message: string | null, toastDescription?: string) => {
      setErrorState(message ?? "");
      if (message) {
        toast.add({
          title,
          description: toastDescription ?? message,
          type: "error",
        });
      }
    },
    [title]
  );

  return [error, setError];
}
