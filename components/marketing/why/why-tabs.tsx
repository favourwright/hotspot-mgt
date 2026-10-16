"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { WHY } from "@/lib/landing-content";
import { gsap } from "@/lib/gsap";
import { DURATION, EASE, STAGGER, useGsapScope } from "@/components/marketing/motion";
import { MediaCard } from "@/components/marketing/media-card";

/**
 * The tab row and the panel it switches.
 *
 * Deliberately not `components/system/tabs`. That one is a pill on a
 * raised track, which is right inside a card's inset panel where it has a
 * surface to sit on and wrong here, where the reference has bare text on
 * open white and a track would read as a stray control bar. What it does
 * borrow is the system's semantics: inactive is `muted-foreground`, active
 * is `foreground`, and the accent appears only as the marker, never as the
 * label colour.
 *
 * Roving focus and the arrow keys are handled by hand for the same reason.
 * It is a tablist of four items; adopting a primitive for that would mean
 * adopting its chrome too.
 */
export function WhyTabs() {
  const [active, setActive] = React.useState(0);
  const tab = WHY.tabs[active];

  // Rebuilt whenever the panel changes, which is what plays the transition.
  // The context reverts first, so the previous tween's inline styles are
  // cleared rather than fought over.
  const panel = useGsapScope<HTMLDivElement>(
    (scope) => {
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(
          scope.querySelectorAll("[data-panel-item]"),
          { opacity: 0, y: 14 },
          {
            opacity: 1,
            y: 0,
            duration: DURATION.fast,
            ease: EASE.out,
            stagger: STAGGER,
            clearProps: "opacity,transform",
          }
        );
      });
    },
    [active]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    setActive((current) => (current + delta + WHY.tabs.length) % WHY.tabs.length);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={WHY.eyebrow}
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-x-8 gap-y-3"
      >
        {WHY.tabs.map((item, index) => {
          const selected = index === active;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              id={`why-tab-${item.key}`}
              aria-selected={selected}
              aria-controls={`why-panel-${item.key}`}
              // Only the selected tab is in the tab order; the arrow keys
              // move between them, which is what a tablist is supposed to
              // do and what stops four tabs eating four tab stops.
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={cn(
                "flex items-center gap-2.5 rounded-full text-sm font-medium transition-colors",
                "focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {/* The same marker the hero uses, so "this one" means the
                  same thing in both places. It holds its space when
                  inactive so the row does not shuffle on every switch. */}
              <span
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                  selected ? "border-primary" : "border-transparent"
                )}
              >
                <span
                  className={cn(
                    "size-1 rounded-full transition-colors",
                    selected ? "bg-primary" : "bg-transparent"
                  )}
                />
              </span>
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        ref={panel}
        role="tabpanel"
        id={`why-panel-${tab.key}`}
        aria-labelledby={`why-tab-${tab.key}`}
        className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_minmax(0,15rem)]"
      >
        {/* The wrapper carries `data-panel-item`, not the card: the card
            takes a `seed` and a `className` and nothing else, so it stays
            a plain swap point for real imagery later. */}
        <div data-panel-item className="aspect-square w-full">
          <MediaCard seed={active * 2} className="size-full" />
        </div>
        <div data-panel-item className="aspect-square w-full max-sm:hidden">
          <MediaCard seed={active * 2 + 1} className="size-full" />
        </div>

        <div data-panel-item className="flex flex-col justify-center gap-6">
          <p className="text-[0.95rem] leading-relaxed text-pretty">
            {tab.copy}
          </p>
          <Link
            href={WHY.link.href}
            className="group inline-flex w-fit items-center gap-3 text-xs font-medium tracking-[0.08em] uppercase underline underline-offset-[6px] transition-colors hover:text-primary"
          >
            {WHY.link.label}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </div>
  );
}
