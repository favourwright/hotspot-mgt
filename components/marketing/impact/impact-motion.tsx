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

/**
 * Section 4's motion.
 *
 * The grid draws itself, then the figures land in it.
 *
 * The lines emanate from the top-left corner, which is where the eyebrow
 * is and where reading starts: horizontals run left to right, the
 * verticals run top to bottom, and the stagger follows distance from
 * that corner. A sweep with no origin reads as arbitrary; this one has a
 * direction the eye can follow.
 *
 * One tween covers both axes. A horizontal rule starts at `scaleX(0)`
 * with `scaleY` already at 1, and a vertical one the other way round, so
 * animating both to 1 is a no-op on whichever axis is already there.
 *
 * Slow and with a soft ease on purpose. A fast line-draw reads as a UI
 * transition; at just over a second it reads as the section being
 * constructed, which is the only reason to animate structure at all.
 */
export function ImpactMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scope = useGsapScope<HTMLElement>((root) => {
    const media = gsap.matchMedia();

    media.add("(prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline({
        defaults: { ease: EASE.out },
        scrollTrigger: { trigger: root, start: "top 75%", once: true },
      });

      timeline
        .to('[data-reveal="eyebrow"]', revealVars({ duration: DURATION.fast }))
        .to(
          "[data-rule]",
          {
            scaleX: 1,
            scaleY: 1,
            duration: DURATION.slow,
            ease: EASE.soft,
            stagger: STAGGER,
            onComplete(this: gsap.core.Tween) {
              // Attribute first, inline styles second, in one synchronous
              // block. `clearProps` in the tween vars runs BEFORE
              // `onComplete`, which would leave each rule matching its
              // collapsed CSS start state with no inline transform to
              // override it, and collapse the whole grid for a frame at
              // the end of its own draw.
              const nodes = this.targets() as HTMLElement[];
              nodes.forEach((node) => node.removeAttribute("data-rule"));
              gsap.set(nodes, { clearProps: "transform" });
            },
          },
          "-=0.2"
        )
        // The figures arrive while the last lines are still drawing, so
        // the two read as one movement. Staggered wider than elsewhere on
        // the page: these are four separate statements rather than one
        // block, and a tight stagger makes them read as a single flicker.
        .to(
          '[data-reveal="figure"]',
          revealVars({ duration: DURATION.base, stagger: STAGGER * 1.5 }),
          "-=0.55"
        );
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
