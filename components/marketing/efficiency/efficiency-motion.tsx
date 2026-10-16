"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import {
  DURATION,
  EASE,
  STAGGER,
  revealVars,
  useGsapScope,
} from "@/components/marketing/motion";

/**
 * Section 3's motion: an entrance, then a pinned horizontal track.
 *
 * ## The entrance
 *
 * The columns of the sales chart grow from the baseline as the section
 * arrives. That is the one piece of motion here doing more than
 * decoration: a bar chart's meaning is its heights, so animating the
 * heights animates the content rather than the packaging.
 *
 * `scaleY` rather than `height`, because scale is composited and height
 * is a layout property - animating height on nine elements inside a flex
 * row relayouts the row every frame. The trade is a squashed 4px cap
 * while the column is short; it is correct at rest.
 *
 * ## The pin
 *
 * Pinning is the expensive, layout-shifting option, so it is fenced in
 * tightly:
 *
 * - **Wide screens only.** A pinned section hijacks the scroll, and on a
 *   phone that reads as the page having frozen. Below `lg` the panels are
 *   a plain stacked column and nothing is pinned.
 * - **Motion allowed only.** Taking scroll away from somebody who asked
 *   for less motion is the most intrusive thing on this page.
 * - **Both branches live in one `gsap.matchMedia`**, so crossing either
 *   boundary tears the pin down and rebuilds the other arrangement
 *   cleanly, rather than leaving a stale pin spacer behind.
 *
 * The distance is measured, not guessed, and measured again on every
 * refresh. `end` is a function and `invalidateOnRefresh` is set because
 * the track's width depends on the viewport: hard-coding the distance
 * leaves the last panel unreachable at one window size and overshoots at
 * another.
 */
export function EfficiencyMotion({
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
        scrollTrigger: { trigger: root, start: "top 80%", once: true },
      });

      timeline
        .to('[data-reveal="eyebrow"]', revealVars({ duration: DURATION.fast }))
        .to('[data-reveal="aside"]', revealVars({ duration: DURATION.fast }), "<")
        .to('[data-reveal="card"]', revealVars({ stagger: 0.12 }), "-=0.15")
        .to(
          "[data-bar]",
          {
            scaleY: 1,
            duration: DURATION.base,
            ease: EASE.soft,
            stagger: STAGGER / 2,
            onComplete(this: gsap.core.Tween) {
              // Attribute first, inline styles second, in one synchronous
              // block. `clearProps` in the tween vars runs BEFORE
              // `onComplete`, which would leave the bars matching the CSS
              // start state with no inline transform to override it and
              // flash them to zero height at the end of their own growth.
              const nodes = this.targets() as HTMLElement[];
              nodes.forEach((node) => node.removeAttribute("data-bar"));
              gsap.set(nodes, { clearProps: "transform" });
            },
          },
          "-=0.4"
        );
    });

    media.add(
      "(min-width: 64rem) and (prefers-reduced-motion: no-preference)",
      () => {
        const viewport = root.querySelector<HTMLElement>(
          "[data-track-viewport]"
        );
        const track = root.querySelector<HTMLElement>("[data-track]");
        if (!viewport || !track) return;

        // How far the track has to travel for its right edge to reach the
        // viewport's. Zero on a window wide enough to show everything, in
        // which case there is nothing to pin for.
        const distance = () =>
          Math.max(0, track.scrollWidth - viewport.clientWidth);
        if (distance() === 0) return;

        // The pin takes over the clipping now that it is definitely
        // running. Until this point the viewport scrolls natively, which
        // is what keeps the later cards reachable when the pin does not
        // run at all. Reset the native position first: a reader may have
        // already scrolled the row before this branch matched, and the
        // scrub positions the track from zero.
        const previousOverflow = viewport.style.overflowX;
        viewport.scrollLeft = 0;
        viewport.style.overflowX = "hidden";

        gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: root,
            start: "center center",
            end: () => `+=${distance()}`,
            pin: true,
            // Damped rather than locked to the scroll position, the same
            // smoothing Lenis applies to the page itself. `true` here
            // reads as mechanical next to a smooth-scrolled page.
            scrub: 1,
            // Chrome can show a frame of the unpinned position at the
            // moment the pin engages; this starts it fractionally early.
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });

        // Returned to `matchMedia`, so crossing back under `lg` or into
        // reduced motion hands the clipping back to native scrolling
        // rather than leaving the row clipped and unscrollable.
        return () => {
          viewport.style.overflowX = previousOverflow;
        };
      }
    );
  }, []);

  // The pin's spacer is sized from measurements taken at build time, and
  // the fonts and the media cards above this section both settle after
  // that. One refresh once everything has loaded, or the pin starts at
  // the wrong scroll position.
  React.useEffect(() => {
    const refresh = () => ScrollTrigger.refresh();
    if (document.readyState === "complete") refresh();
    else window.addEventListener("load", refresh, { once: true });
    return () => window.removeEventListener("load", refresh);
  }, []);

  return (
    <section ref={scope} className={cn("relative", className)}>
      {children}
    </section>
  );
}
