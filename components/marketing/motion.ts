"use client";

import * as React from "react";

import { gsap } from "@/lib/gsap";

/**
 * Shared motion vocabulary for the landing page.
 *
 * Kept in one place for the same reason `CONTENT_WIDTHS` is: a reveal that
 * runs 0.6s in one section and 0.9s in the next reads as two different
 * websites, and nobody notices until every section is already built.
 */
export const EASE = {
  /** Entrances. Decelerating, no overshoot. */
  out: "power3.out",
  /** Anything that moves and then settles under its own weight. */
  soft: "power2.out",
} as const;

export const DURATION = {
  fast: 0.4,
  base: 0.8,
  slow: 1.1,
} as const;

/** Stagger between siblings in a revealed group. */
export const STAGGER = 0.08;

/**
 * Frame-rate independent damped interpolation: move `current` a fraction of
 * the way toward `target`, once per frame.
 *
 * This is the thing that actually makes pointer- and scroll-driven motion
 * feel smooth, and `gsap.utils.interpolate` on its own is not it. Three
 * separate effects are doing the work:
 *
 * 1. Input and output are decoupled. `pointermove` and `scroll` fire at
 *    irregular, bursty, browser-coalesced rates. Recording a target in the
 *    event and applying it on the ticker means exactly one write per frame
 *    rather than N, so nothing lands twice in one frame or skips one.
 * 2. It is a first-order low-pass filter. Spiky input deltas get damped
 *    instead of being rendered faithfully as spikes.
 * 3. It replaces per-event tweens. Spawning or overwriting a tween on every
 *    event is allocation churn and produces a visible restart-from-rest
 *    stutter each time the target moves.
 *
 * The `deltaRatio` term is the part that is easy to leave out and wrong to.
 * A fixed `lerp(current, target, 0.1)` per frame converges twice as fast on
 * a 120Hz phone as on a 60Hz laptop, so the same code feels like two
 * different animations depending on the display. `deltaRatio()` is the
 * frame's length relative to 60fps, and raising the retained fraction to
 * that power makes convergence a function of elapsed time instead of frame
 * count.
 *
 * Use this for continuously retargeted values. Do NOT use it for entrance
 * animations, which are one-shots that want a real easing curve, or on top
 * of a `ScrollTrigger` with a numeric `scrub`, which already damps
 * internally and will double-smooth into mush.
 *
 * @param lambda Fraction of the remaining distance covered per 60fps frame.
 *               Lower is heavier. 0.1 is a good default; above ~0.3 the
 *               damping stops being perceptible and you may as well assign.
 */
export function damp(current: number, target: number, lambda = 0.1): number {
  return gsap.utils.interpolate(
    current,
    target,
    1 - Math.pow(1 - lambda, gsap.ticker.deltaRatio())
  );
}

/**
 * The page's one entrance animation.
 *
 * Elements opt in by carrying `data-reveal` in the server-rendered markup,
 * and `landing.css` puts them in their start state. That ordering is the
 * whole point: the start state arrives with the HTML, so there is never a
 * frame where the finished layout is visible before JavaScript hides it.
 * Setting the start state from an effect instead is the standard way to
 * produce exactly that flash.
 *
 * On completion the attribute is removed and the inline styles GSAP wrote
 * are cleared, in that order within one synchronous block. Reversing the
 * two would leave the element matching the CSS start state for a frame with
 * no inline opacity to override it, which flashes it back out right at the
 * end of its own reveal.
 *
 * Returns tween *vars* rather than a tween, so the caller's timeline is
 * what creates it. `gsap.to()` starts playing the moment it is constructed,
 * so building tweens up front and adding them to a timeline afterwards
 * parents them to the root timeline in between.
 */
export function revealVars(vars: gsap.TweenVars = {}): gsap.TweenVars {
  return {
    opacity: 1,
    y: 0,
    scale: 1,
    duration: DURATION.base,
    ease: EASE.out,
    stagger: STAGGER,
    onStart(this: gsap.core.Tween) {
      // Promoted for the duration of the tween and no longer. A permanent
      // `will-change` keeps a layer alive for every revealed element on the
      // page, which costs memory and, past a few dozen, costs frames.
      gsap.set(this.targets(), { willChange: "transform, opacity" });
    },
    onComplete(this: gsap.core.Tween) {
      const nodes = this.targets() as HTMLElement[];
      nodes.forEach((node) => node.removeAttribute?.("data-reveal"));
      gsap.set(nodes, { clearProps: "opacity,transform,willChange" });
    },
    ...vars,
  };
}

/**
 * `useLayoutEffect` that does not warn during the server render.
 *
 * Client components still render on the server to produce the initial HTML,
 * and React logs for every `useLayoutEffect` reached that way. The effect
 * genuinely has to be a layout effect: it sets start states, and running
 * after paint means the browser shows the end state for one frame first.
 */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Build a section's animations inside a GSAP context scoped to its root.
 *
 * The context is what makes a section's motion disposable. On unmount
 * `revert()` kills every tween and ScrollTrigger created inside the setup
 * function and restores every inline style it wrote. Without it,
 * ScrollTriggers outlive the page and keep measuring a DOM that is gone,
 * which is the usual cause of a second visit to a route animating wrongly
 * or not at all.
 *
 * Returns the ref to attach to the section root. Selector strings inside
 * `setup` are automatically scoped to that element.
 */
export function useGsapScope<T extends HTMLElement = HTMLDivElement>(
  setup: (scope: T, context: gsap.Context) => void,
  deps: React.DependencyList = []
) {
  const ref = React.useRef<T | null>(null);
  const setupRef = React.useRef(setup);

  // Assigned in an insertion effect rather than during render. Writing a
  // ref while rendering is not safe under concurrent rendering, where a
  // render can be thrown away: the discarded closure would be left in the
  // ref. Insertion effects run before layout effects in the same commit,
  // so the effect below still sees the current one.
  React.useInsertionEffect(() => {
    setupRef.current = setup;
  });

  useIsomorphicLayoutEffect(() => {
    const scope = ref.current;
    if (!scope) return;

    // GSAP hands the context to its own setup function, which is the only
    // way to reach it from in here: a `const context = gsap.context(...)`
    // referenced inside that same callback is still in its temporal dead
    // zone when the callback runs synchronously.
    const context = gsap.context(
      (self) => setupRef.current(scope, self as gsap.Context),
      scope
    );
    return () => context.revert();
    // The setup function is deliberately not a dependency: it is a fresh
    // closure on every render, and depending on it would tear down and
    // rebuild every timeline on the page each time React re-renders. That
    // is what the ref above is for.
  }, deps);

  return ref;
}

/**
 * Run a callback on GSAP's ticker for the lifetime of the component.
 *
 * One ticker drives Lenis, every tween and every damped value on the page,
 * so a per-frame job belongs here rather than in its own
 * `requestAnimationFrame`. Two loops is how a value ends up being read in
 * one frame and written in the next.
 */
export function useTicker(callback: () => void, enabled = true) {
  const callbackRef = React.useRef(callback);

  React.useInsertionEffect(() => {
    callbackRef.current = callback;
  });

  React.useEffect(() => {
    if (!enabled) return;
    const tick = () => callbackRef.current();
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [enabled]);
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the visitor has asked for less motion.
 *
 * Read through `useSyncExternalStore` rather than an effect so there is no
 * hydration mismatch: the server snapshot is always `false`, which matches
 * what the server rendered, and the real value arrives on the client
 * without a render where the two disagree.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  );
}

/**
 * Whether a section should be animating at all: on screen, and in a
 * foreground tab.
 *
 * Browsers throttle animation in a hidden tab, but not consistently
 * across engines, and an off-screen element's animation is not reliably
 * stopped at all. Left ungated, a looping marquee or a drifting backdrop
 * is a continuous wakeup for something nobody is looking at, which on a
 * phone is measurable battery for no benefit.
 *
 * Returns a boolean rather than writing to the DOM, so one caller can
 * pause a tween with it and another can render it as an attribute for
 * CSS to key off.
 */
export function useAmbientActive<T extends HTMLElement>(
  ref: React.RefObject<T | null>
): boolean {
  const [active, setActive] = React.useState(true);

  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let onScreen = true;
    const apply = () =>
      setActive(onScreen && document.visibilityState === "visible");

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        apply();
      },
      // A little slack, so motion is already running by the time the
      // section scrolls into view rather than starting as it appears.
      { rootMargin: "200px" }
    );

    observer.observe(element);
    document.addEventListener("visibilitychange", apply);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
    };
  }, [ref]);

  return active;
}
