"use client";

import * as React from "react";

import { damp, usePrefersReducedMotion, useTicker } from "@/components/marketing/motion";

interface PointerFieldOptions {
  /** Heaviness of the follow. Lower trails further behind the cursor. */
  lambda?: number;
  /** Skip writes smaller than this, in normalised units. */
  epsilon?: number;
}

/**
 * Publishes a damped, normalised pointer position on an element as two CSS
 * custom properties, `--pointer-x` and `--pointer-y`, each running -1 to 1
 * from edge to edge with 0 at the centre.
 *
 * This is the seam every pointer-reactive layer in the hero hangs off,
 * rather than each one attaching its own listener. One element owns the
 * input, one value is damped, and anything inside can read it in plain CSS
 * with no JavaScript of its own:
 *
 *     translate: calc(var(--pointer-x, 0) * 12px) calc(var(--pointer-y, 0) * 12px);
 *
 * Two deliberate restrictions:
 *
 * - **Fine pointers only.** There is no hover on a touchscreen, and
 *   `pointermove` during a drag would yank the field around under the
 *   finger. On coarse pointers the properties simply stay at their
 *   fallback of 0 and every consumer renders centred.
 * - **No write when nothing moved.** Setting a custom property invalidates
 *   style for the whole subtree that reads it, so writing an unchanged
 *   value every frame is pure recalculation. Once the damped value has
 *   effectively converged the ticker goes quiet until the pointer moves
 *   again.
 */
export function usePointerField<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  { lambda = 0.08, epsilon = 0.0005 }: PointerFieldOptions = {}
) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // A ref rather than state. Whether the field is live is only ever read
  // from the ticker, never rendered, so putting it in state would buy a
  // re-render per transition and a cascading-render lint error for nothing.
  const live = React.useRef(false);

  const target = React.useRef({ x: 0, y: 0 });
  const current = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    live.current = true;

    const onMove = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      // Clamped because the listener is on the window: the pointer can sit
      // outside the element and would otherwise drive the field past 1.
      target.current = {
        x: clamp((event.clientX - bounds.left) / bounds.width),
        y: clamp((event.clientY - bounds.top) / bounds.height),
      };
    };

    // The field should also recentre when the pointer leaves the document
    // entirely, which produces no further `pointermove`.
    const onLeave = () => {
      target.current = { x: 0, y: 0 };
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      live.current = false;
      element.style.removeProperty("--pointer-x");
      element.style.removeProperty("--pointer-y");
    };
  }, [ref, prefersReducedMotion]);

  useTicker(() => {
    const element = ref.current;
    if (!element || !live.current) return;

    const next = {
      x: damp(current.current.x, target.current.x, lambda),
      y: damp(current.current.y, target.current.y, lambda),
    };

    if (
      Math.abs(next.x - current.current.x) < epsilon &&
      Math.abs(next.y - current.current.y) < epsilon
    ) {
      return;
    }

    current.current = next;
    element.style.setProperty("--pointer-x", next.x.toFixed(4));
    element.style.setProperty("--pointer-y", next.y.toFixed(4));
  }, !prefersReducedMotion);
}

/** Map a 0..1 position within the element onto -1..1, clamped. */
function clamp(ratio: number) {
  return Math.max(-1, Math.min(1, ratio * 2 - 1));
}
