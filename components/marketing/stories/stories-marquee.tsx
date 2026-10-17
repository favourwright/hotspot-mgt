"use client";

import * as React from "react";
import { Quote, Star } from "lucide-react";

import { cn, getAvatarUrl } from "@/lib/utils";
import { STORIES } from "@/lib/landing-content";
import { gsap } from "@/lib/gsap";
import {
  useAmbientActive,
  usePrefersReducedMotion,
  useTicker,
} from "@/components/marketing/motion";

/**
 * The stories track: an endless horizontal scroll with a progress
 * control that cannot drift from it.
 *
 * ## The loop
 *
 * The list is rendered three times and the track tweened
 * `xPercent: 0 -> -33.333` on a linear, infinitely repeating tween. One
 * third of the track is exactly one copy, so at the end of a cycle the
 * second copy sits precisely where the first began and the wrap is
 * invisible. Expressing it in percent rather than pixels means there is
 * nothing to re-measure when the window resizes.
 *
 * Three copies rather than two because the seam has to stay off-screen:
 * after the track has travelled one copy, two copies' worth still has to
 * cover the viewport.
 *
 * ## The progress control
 *
 * Everything it shows comes from the tween's own `progress()`, read on
 * the same ticker that drives the tween, so the readout cannot drift
 * from the motion - the usual failure of a carousel bar running on its
 * own timer.
 *
 * The bar fills rather than slides. Its left edge is pinned at the
 * track's start and its right edge advances across the cycle. Then, in
 * the last `EXIT_SECONDS`, the right edge holds at the end and the LEFT
 * edge races up to meet it, so the bar collapses against the right-hand
 * side and reads as leaving the track. It reappears at the far left at
 * zero width and grows again.
 *
 * That hand-off cannot flash, and the reason is worth stating: the last
 * frame of the exit and the first frame of the re-entry are both zero
 * width. Nothing is on screen at the moment the edges jump, so there is
 * nothing to see jump.
 *
 * The exit is a fixed duration rather than a fixed fraction of the
 * cycle. A fraction would make the catch-up slower the longer the list
 * gets, which is the opposite of quick.
 *
 * ## The index
 *
 * A vertical roll: a one-line window over a stack of numbers, moved by
 * `translateY`. Composited, and it changes four times a cycle rather
 * than sixty times a second - the bar gets the per-frame treatment
 * because it has to be continuous, the number does not.
 *
 * The stack carries a duplicate `01` after the last number so the wrap
 * rolls FORWARD onto it instead of spinning backwards through 03 and
 * 02; once that roll lands, the position resets to the real `01` with
 * transitions suppressed for a frame. Same trick as the track's seam.
 *
 * ## Reduced motion
 *
 * No tween at all. The track becomes an ordinary horizontally
 * scrollable row and progress is computed from `scrollLeft` instead,
 * feeding the same variable, so the control behaves identically and the
 * reader is in charge of the pace.
 */
const COPIES = 3;
const CYCLE_PERCENT = 100 / COPIES;
/** How long the bar takes to collapse against the right-hand end. */
const EXIT_SECONDS = 0.45;

export function StoriesMarquee() {
  const items = STORIES.items;

  const viewport = React.useRef<HTMLDivElement | null>(null);
  const track = React.useRef<HTMLDivElement | null>(null);
  const control = React.useRef<HTMLDivElement | null>(null);
  const tween = React.useRef<gsap.core.Tween | null>(null);

  const [paused, setPaused] = React.useState(false);
  /** Which number the roll is showing. `items.length` is the duplicate. */
  const rollRef = React.useRef(0);

  const prefersReducedMotion = usePrefersReducedMotion();
  const onScreen = useAmbientActive(viewport);
  const running = onScreen && !paused && !prefersReducedMotion;

  // One cycle carries the whole list past, so its duration is the list's
  // length times the time each card should be on screen.
  const duration = items.length * 6;

  React.useEffect(() => {
    const element = track.current;
    if (!element || prefersReducedMotion) return;

    const instance = gsap.to(element, {
      xPercent: -CYCLE_PERCENT,
      ease: "none",
      duration,
      repeat: -1,
    });
    tween.current = instance;

    return () => {
      instance.kill();
      tween.current = null;
      gsap.set(element, { clearProps: "transform" });
    };
  }, [duration, prefersReducedMotion]);

  React.useEffect(() => {
    const instance = tween.current;
    if (!instance) return;
    if (running) instance.resume();
    else instance.pause();
  }, [running]);

  /**
   * Publish progress for the control to read. A CSS variable rather than
   * React state: it changes every frame, and re-rendering four cards
   * sixty times a second to move one thumb would be absurd. The index,
   * which changes four times a cycle, is state.
   */
  useTicker(() => {
    const node = control.current;
    if (!node) return;

    let progress: number;
    if (prefersReducedMotion) {
      const scroller = viewport.current;
      if (!scroller) return;
      const span = scroller.scrollWidth / COPIES;
      progress = span > 0 ? (scroller.scrollLeft % span) / span : 0;
    } else {
      const instance = tween.current;
      if (!instance) return;
      progress = instance.progress();
    }

    // The cycle is a long fill followed by a short collapse. Capped so a
    // very short list cannot hand the whole cycle over to the exit.
    const exitFraction = Math.min(0.3, EXIT_SECONDS / duration);
    const fillEnd = 1 - exitFraction;

    let left = 0;
    let right = 100;
    if (progress < fillEnd) {
      // Filling: left pinned, right edge advancing.
      right = (1 - progress / fillEnd) * 100;
    } else {
      // Leaving: right pinned at the end, left edge catching up.
      const t = (progress - fillEnd) / exitFraction;
      const eased = t * t * (3 - 2 * t);
      left = eased * 100;
      right = 0;
    }

    node.style.setProperty("--bar-left", `${left.toFixed(2)}%`);
    node.style.setProperty("--bar-right", `${right.toFixed(2)}%`);

    // The number holds on the last item through the exit, then rolls
    // forward onto the duplicate.
    const next =
      progress < fillEnd
        ? Math.min(
            items.length - 1,
            Math.floor((progress / fillEnd) * items.length)
          )
        : items.length;

    if (next === rollRef.current) return;

    if (next === 0 && rollRef.current === items.length) {
      // Coming off the duplicate back to the real first number: move
      // there without animating, or it spins all the way back. The
      // transition's duration is multiplied by this, so zero disables
      // it for exactly one frame.
      node.style.setProperty("--roll-anim", "0");
      requestAnimationFrame(() => node.style.setProperty("--roll-anim", "1"));
    }

    rollRef.current = next;
    node.style.setProperty("--roll-step", String(next));
  });

  return (
    <div>
      <div
        ref={viewport}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className={cn(
          "overflow-hidden",
          // Under reduced motion the reader scrolls it themselves, so it
          // has to actually be scrollable.
          prefersReducedMotion && "overflow-x-auto"
        )}
      >
        <div ref={track} className="flex w-max gap-5">
          {Array.from({ length: COPIES }).map((_, copy) =>
            items.map((item) => (
              <StoryCard
                key={`${copy}-${item.name}`}
                item={item}
                // Only the first copy is real as far as assistive
                // technology is concerned; the rest are the same quotes
                // again and would otherwise be read three times.
                hidden={copy > 0}
              />
            ))
          )}
        </div>
      </div>

      <div
        ref={control}
        className="mt-12 flex items-center justify-center gap-4 text-sm tabular-nums"
      >
        {/* The roll. A one-line window over the numbers, with a copy of
            the first one at the end so the wrap goes forwards. */}
        <span className="relative block h-[1.3em] w-[2ch] overflow-hidden font-medium">
          {/* Driven by the same per-frame write as the bar, not by React
              state. They are read from one `progress()` on one tick and
              written to one element, so the number cannot lag the bar
              however the renderer schedules work - and the component
              stops re-rendering four times a cycle to move a digit. */}
          <span
            className="block"
            style={{
              // Per step, not per stack: the column is
              // `items.length + 1` lines tall, so one line is that
              // fraction of its own height.
              transform: `translateY(calc(var(--roll-step, 0) * -${(
                100 /
                (items.length + 1)
              ).toFixed(4)}%))`,
              transitionProperty: "transform",
              transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
              transitionDuration: "calc(var(--roll-anim, 1) * 500ms)",
            }}
          >
            {Array.from({ length: items.length + 1 }).map((_, line) => (
              <span key={line} className="block h-[1.3em] leading-[1.3em]">
                {String((line % items.length) + 1).padStart(2, "0")}
              </span>
            ))}
          </span>
        </span>

        <span className="relative h-1.5 w-40 overflow-hidden rounded-full bg-sunken sm:w-56">
          {/* Both edges are driven independently, so the bar can grow
              from the left and then be eaten from the left. Rounding
              stays correct at every size because the element's own box
              is what is rounded - nothing is scaled. */}
          <span
            className="absolute inset-y-0 rounded-full bg-foreground"
            style={{
              left: "var(--bar-left, 0%)",
              right: "var(--bar-right, 100%)",
            }}
          />
        </span>

        <span className="text-muted-foreground">
          {String(items.length).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
}

function StoryCard({
  item,
  hidden,
}: {
  item: (typeof STORIES.items)[number];
  hidden: boolean;
}) {
  return (
    <article
      aria-hidden={hidden || undefined}
      className="flex w-[21rem] shrink-0 flex-col justify-between gap-10 rounded-surface bg-sunken p-7 sm:w-[25rem] sm:p-8"
    >
      <div>
        <Quote className="size-7 text-foreground/25" aria-hidden />
        <p className="mt-5 text-[0.95rem] leading-relaxed text-pretty">
          {item.quote}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {/* The same generated avatar the product uses for customers,
              seeded by name so each card keeps its own.

              `loading="lazy"` is not only about bandwidth here. These are
              the page's only subresources fetched from a third party, and
              `window.load` waits for every one of them - which is also
              when `ScrollTrigger` re-measures every trigger on the page.
              Eager, a slow response from that host delays the measure
              until after somebody has started scrolling, and the refresh
              lands as a hitch mid-gesture. A lazy image is not part of
              `load` at all.

              The dimensions are explicit for the usual reason: the box is
              reserved before the response arrives, so nothing reflows
              into place and no trigger measured against the old height. */}
          <img
            src={getAvatarUrl(item.name)}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-full bg-raised"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {item.role}
            </p>
          </div>
        </div>

        <p
          className="flex shrink-0 gap-0.5"
          aria-label={`${item.rating} out of 5`}
        >
          {Array.from({ length: item.rating }).map((_, star) => (
            <Star
              key={star}
              aria-hidden
              className="size-3.5 fill-primary text-primary"
            />
          ))}
        </p>
      </div>
    </article>
  );
}
