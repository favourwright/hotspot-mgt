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

/** Section 8's entrance. The marquee owns its own motion. */
export function StoriesMotion({
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
        .to('[data-reveal="heading"]', revealVars({ duration: DURATION.slow }), "-=0.2")
        .to('[data-reveal="support"]', revealVars(), "-=0.8")
        .to('[data-reveal="track"]', revealVars({ duration: DURATION.slow }), "-=0.6");
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
