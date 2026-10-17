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
 * Section 6's motion.
 *
 * The steps arrive one after another, a little wider apart than the
 * page's usual stagger: they are a sequence, and a sequence that lands
 * all at once stops reading as one.
 */
export function HowMotion({
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
          '[data-reveal="heading"]',
          revealVars({ duration: DURATION.slow, stagger: 0.08 }),
          "-=0.2"
        )
        .to('[data-reveal="support"]', revealVars(), "-=0.8")
        .to(
          '[data-reveal="step"]',
          revealVars({ duration: DURATION.base, stagger: STAGGER * 2 }),
          "-=0.6"
        )
        .to('[data-reveal="mock"]', revealVars({ duration: DURATION.slow }), "<");
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
