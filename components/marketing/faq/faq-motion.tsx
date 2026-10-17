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

/** Section 9's entrance. */
export function FaqMotion({
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
          '[data-reveal="row"]',
          revealVars({ duration: DURATION.base, stagger: STAGGER }),
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
