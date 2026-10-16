"use client";

import * as React from "react";
import { ReactLenis, useLenis } from "lenis/react";

import { gsap, ScrollTrigger } from "@/lib/gsap";
import { usePrefersReducedMotion } from "@/components/marketing/motion";

/**
 * Marries Lenis to GSAP's ticker.
 *
 * Left alone, these two each run their own `requestAnimationFrame` loop.
 * Lenis computes a new scroll position in its loop and GSAP reads it in
 * another, so which one runs first in a given frame is undefined. The
 * result is that scroll-linked tweens are reading last frame's position
 * about half the time, which looks like jitter on anything pinned or
 * parallaxed and is the single most common reason a Lenis page feels worse
 * than a native one.
 *
 * Three lines fix it, and all three are load-bearing:
 *
 * - `autoRaf: false` on the provider below stops Lenis starting its own
 *   loop at all.
 * - Lenis is stepped from GSAP's ticker instead, so there is exactly one
 *   loop and a guaranteed order within the frame.
 * - `lagSmoothing(0)` turns off GSAP's habit of rewriting its own clock
 *   after a long frame. That recovery is right for a standalone tween and
 *   wrong here, because Lenis's clock does not get the same adjustment and
 *   the two drift apart for a second afterwards.
 */
function LenisGsapBridge() {
  // Updating ScrollTrigger from Lenis's scroll event, rather than letting it
  // listen to the native one, keeps measurement in step with the smoothed
  // position rather than the real one.
  const lenis = useLenis(() => ScrollTrigger.update());

  React.useEffect(() => {
    if (!lenis) return;

    // GSAP's ticker reports seconds; Lenis wants milliseconds.
    const step = (time: number) => lenis.raf(time * 1000);

    gsap.ticker.add(step);
    gsap.ticker.lagSmoothing(0);

    // Triggers created while the page was still laying out measured against
    // a document that has since grown.
    ScrollTrigger.refresh();

    return () => {
      gsap.ticker.remove(step);
      // The ticker is global and outlives this page, so put the default
      // back rather than leaving every future animation unsmoothed.
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, [lenis]);

  return null;
}

/**
 * Smooth scrolling, scoped to whatever it wraps.
 *
 * Mounted in the marketing layout and nowhere else, so the admin area, the
 * auth pages and every tenant portal keep native scrolling and ship none of
 * this. Lenis restores the document styles it set when it unmounts, which
 * is what makes client-side navigation away from the landing page safe.
 */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <ReactLenis
      root
      options={{
        autoRaf: false,
        // Smoothing the wheel is the whole feature and also the thing a
        // visitor asking for reduced motion is asking not to have: it
        // detaches the page from their input device. Touch is left alone
        // either way, since Lenis does not smooth it by default and the
        // platform's own momentum is what people expect there.
        smoothWheel: !prefersReducedMotion,
        duration: 1.05,
      }}
    >
      <LenisGsapBridge />
      {children}
    </ReactLenis>
  );
}
