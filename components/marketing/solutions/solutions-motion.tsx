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
 * Section 7's entrance. The accordion's own motion is CSS and lives with
 * the component; this only brings the section on.
 */
export function SolutionsMotion({
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
        .to('[data-reveal="heading"]', revealVars({ duration: DURATION.slow }), "-=0.2")
        .to('[data-reveal="support"]', revealVars(), "-=0.8")
        .to(
          '[data-reveal="panel"]',
          revealVars({ duration: DURATION.base, stagger: STAGGER * 1.5 }),
          "-=0.6"
        );
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
