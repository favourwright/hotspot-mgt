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
 * Section 10's entrance.
 *
 * Two beats rather than one. The panel's own content arrives first, as
 * every other section's does; the footer under it is a separate trigger
 * on its own element, because the panel is tall enough that a single
 * trigger at the top would have played the footer's reveal long before
 * anybody scrolled far enough to see it.
 *
 * The wordmark is not in either. It fades with scroll rather than on
 * arrival - see the scrub below - because it is the last thing on the
 * page and a thing that pops into place at the very bottom reads as a
 * load glitch rather than as a reveal.
 */
export function CtaMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scope = useGsapScope<HTMLElement>((root, ctx) => {
    const media = gsap.matchMedia(ctx);

    media.add("(prefers-reduced-motion: no-preference)", () => {
      const panel = gsap.timeline({
        defaults: { ease: EASE.out },
        scrollTrigger: { trigger: root, start: "top 72%", once: true },
      });
      panel
        .to('[data-reveal="heading"]', revealVars({ duration: DURATION.slow, stagger: 0.08 }))
        .to('[data-reveal="support"]', revealVars(), "-=0.8")
        .to('[data-reveal="action"]', revealVars({ duration: DURATION.base }), "-=0.7")
        .to(
          '[data-reveal="media"]',
          revealVars({ duration: DURATION.slow, stagger: 0.12 }),
          "-=1"
        );

      const footer = root.querySelector("[data-footer]");
      if (footer) {
        gsap.to('[data-reveal="foot"]', {
          ...revealVars({ duration: DURATION.base, stagger: STAGGER }),
          scrollTrigger: { trigger: footer, start: "top 88%", once: true },
        });
      }

      // The wordmark rises into place across the end of the page. Scrubbed
      // rather than triggered, so it is tied to how far the reader has
      // actually gone rather than to a threshold they cross at speed.
      const mark = root.querySelector("[data-wordmark]");
      if (mark) {
        gsap.fromTo(
          mark,
          { yPercent: 18, opacity: 0 },
          {
            yPercent: 0,
            opacity: 1,
            ease: "none",
            scrollTrigger: {
              trigger: mark,
              start: "top bottom",
              // Finished while the mark is still well inside the
              // viewport, NOT at "bottom bottom". The mark is the last
              // thing on the page, so its own bottom only reaches the
              // viewport's at the very end of the scroll - a reader who
              // stops an inch short would be left looking at a wordmark
              // frozen part-way through its fade.
              end: "top 55%",
              scrub: true,
            },
          }
        );
      }
    });
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
