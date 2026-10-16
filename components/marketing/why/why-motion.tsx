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
 * Section 2's motion.
 *
 * The first section on the page whose reveal is driven by scroll rather
 * than by load, so this is also the first real exercise of the Lenis and
 * ScrollTrigger wiring in `smooth-scroll.tsx`.
 *
 * `once: true` because an entrance that replays every time a section
 * passes the fold turns a page into a slideshow. The trigger kills itself
 * after firing, so nothing is left measuring.
 */
export function WhyMotion({
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
        scrollTrigger: {
          trigger: root,
          // Begins once the section is a comfortable way into view rather
          // than at the very edge, so the movement is something you catch
          // mid-scroll instead of something already finished by the time
          // the section is readable.
          start: "top 72%",
          once: true,
        },
      });

      timeline
        .to('[data-reveal="eyebrow"]', revealVars({ duration: DURATION.fast }))
        .to(
          '[data-reveal="heading"]',
          revealVars({ duration: DURATION.slow, stagger: STAGGER }),
          "-=0.2"
        )
        .to('[data-reveal="support"]', revealVars(), "-=0.75")
        .to('[data-reveal="panel"]', revealVars(), "-=0.6");
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
