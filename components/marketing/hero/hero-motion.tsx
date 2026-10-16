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
 * it ships as client JavaScript. This wrapper owns four things: the section
 * element, the damped pointer field published on it, the entrance timeline,
 * and whether the backdrop's ambient drift is allowed to run.
 *
 * Each section on the page gets its own equivalent, so a section's motion
 * can be read, changed or deleted without touching any other, and nothing
 * accumulates into a single timeline nobody dares edit.
 */
export function HeroMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scope = useGsapScope<HTMLElement>((root) => {
    const media = gsap.matchMedia();

    // The reduced-motion case has no branch on purpose. `landing.css`
    // already renders every `[data-reveal]` element in its final state
    // and disables the drift keyframes under that query, so the correct
    // behaviour is to build nothing rather than to animate to where
    // things already are.
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
        // The rules draw rather than fade, the same gesture section 4
        // uses, so a dashed line means the same thing in both places.
        // Both of the hero's rules are in one tween: they sit far apart
        // vertically, and staggering them reads as two unrelated events
        // rather than one page settling.
        .to(
          "[data-rule]",
          {
            scaleX: 1,
            duration: DURATION.slow,
            ease: EASE.soft,
            onComplete(this: gsap.core.Tween) {
              // Attribute first, inline styles second, in one synchronous
              // block. `clearProps` in the tween vars runs BEFORE
              // `onComplete` and would collapse each rule for a frame at
              // the end of its own draw.
              const nodes = this.targets() as HTMLElement[];
              nodes.forEach((node) => node.removeAttribute("data-rule"));
              gsap.set(nodes, { clearProps: "transform" });
            },
          },
          "-=0.8"
        )
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

      // The scroll settle: the whole field sinks and dims a little as the
      // hero leaves. Applied to the field wrapper, never to a body, which
      // would fight that body's keyframes for `transform`.
      //
      // `scrub: 1` rather than `true`. The numeric form damps the playhead
      // toward the scroll position over roughly a second, which is the
      // same smoothing `damp()` does for pointer input. Hand-lerping on
      // top of it would double-smooth into mush.
      gsap.to("[data-field]", {
        yPercent: 9,
        opacity: 0.75,
        ease: "none",
        scrollTrigger: {
          trigger: root,
          start: "top top",
          end: "bottom top",
          scrub: 1,
        },
      });
    });
  }, []);

  // Publishes `--pointer-x` / `--pointer-y` on the section. The backdrop
  // and anything else that wants to drift reads them in plain CSS.
  usePointerField(scope);

  /**
   * Gate the ambient drift on the hero being both on-screen and in a
   * foreground tab.
   *
   * Browsers throttle animation in a hidden tab, but not consistently
   * across engines, and an off-screen element's composited animation is
   * not reliably stopped at all. Left alone this is a continuous GPU
   * wakeup for something nobody is looking at, which on a phone is
   * measurable battery for zero benefit.
   *
   * Held in state and rendered as an attribute, rather than written to the
   * node directly. The transitions here are rare - crossing the viewport
   * edge, and switching tabs - so the re-render costs nothing, and the
   * alternative mutates a node reached through a ref, which is exactly
   * what the compiler cannot reason about.
   */
  const [ambient, setAmbient] = React.useState<"running" | "paused">(
    "running"
  );

  React.useEffect(() => {
    const section = scope.current;
    if (!section) return;

    let onScreen = true;

    const apply = () =>
      setAmbient(
        onScreen && document.visibilityState === "visible"
          ? "running"
          : "paused"
      );

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        apply();
      },
      // A little slack, so the drift is already moving by the time the
      // hero scrolls back into view rather than starting as it appears.
      { rootMargin: "200px" }
    );

    observer.observe(section);
    document.addEventListener("visibilitychange", apply);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [scope]);

  return (
    <section
      ref={scope}
      data-ambient={ambient}
      className={cn("relative flex flex-col", className)}
    >
      {children}
    </section>
  );
}
