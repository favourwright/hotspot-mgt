"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { gsap } from "@/lib/gsap";
import {
  DURATION,
  EASE,
  STAGGER,
  revealVars,
  useGsapScope,
} from "@/components/marketing/motion";
import { usePointerField } from "@/components/marketing/use-pointer-field";

/**
 * The hero's motion, and nothing else.
 *
 * The markup is handed in as `children` from a server component, so none of
 * it ships as client JavaScript. This wrapper owns three things: the
 * section element, the damped pointer field published on it, and the
 * entrance timeline. Each section on the page gets its own equivalent, so a
 * section's motion can be read, changed or deleted without touching any
 * other, and nothing accumulates into a single timeline nobody dares edit.
 */
export function HeroMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scope = useGsapScope<HTMLElement>(() => {
    const media = gsap.matchMedia();

    // The reduced-motion case has no branch on purpose. `landing.css`
    // already renders every `[data-reveal]` element in its final state
    // under that query, so the correct behaviour is to build no timeline
    // at all rather than to build one that animates to where things
    // already are.
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline({ defaults: { ease: EASE.out } });

      timeline
        .to(
          '[data-reveal="headline"]',
          revealVars({ duration: DURATION.slow })
        )
        // Overlapping each group with the one before is what makes this
        // read as one movement rather than a queue of five. The rule in
        // particular wants to be drawing while the headline is still
        // settling.
        .to('[data-reveal="rule"]', revealVars(), "-=0.8")
        .to(
          '[data-reveal="marker"]',
          revealVars({ duration: DURATION.fast, stagger: STAGGER }),
          "-=0.65"
        )
        .to('[data-reveal="support"]', revealVars({ stagger: STAGGER }), "<0.1")
        .to(
          '[data-reveal="footer"]',
          revealVars({ duration: DURATION.base, stagger: STAGGER }),
          "-=0.5"
        );
    });
  }, []);

  // Publishes `--pointer-x` / `--pointer-y` on the section. The backdrop
  // and anything else that wants to drift reads them in plain CSS.
  usePointerField(scope);

  return (
    <section ref={scope} className={cn("relative flex flex-col", className)}>
      {children}
    </section>
  );
}
