"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { gsap } from "@/lib/gsap";
import {
  DURATION,
  EASE,
  revealVars,
  useGsapScope,
} from "@/components/marketing/motion";

/**
 * Section 5's motion.
 *
 * The header arrives, then the cards, staggered from the left. Nothing
 * clever: this is the section somebody reads with their wallet in mind,
 * and motion that delays a price being readable works against it.
 */
export function PricingMotion({
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
        scrollTrigger: { trigger: root, start: "top 78%", once: true },
      });

      timeline
        .to('[data-reveal="eyebrow"]', revealVars({ duration: DURATION.fast }))
        .to(
          '[data-reveal="heading"]',
          revealVars({ duration: DURATION.slow, stagger: 0.08 }),
          "-=0.2"
        )
        .to('[data-reveal="support"]', revealVars(), "-=0.8")
        .to(
          '[data-reveal="plan"]',
          revealVars({ duration: DURATION.base, stagger: 0.1 }),
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
