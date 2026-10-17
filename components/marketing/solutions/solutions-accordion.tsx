"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Building2, Network, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SOLUTIONS } from "@/lib/landing-content";
import { MediaCard } from "@/components/marketing/media-card";

/**
 * The horizontal accordion: the active panel widens and reveals an image
 * beside its text, the other two stay narrow.
 *
 * ## How the width is animated
 *
 * By transitioning the row's `grid-template-columns`, set from state as
 * a custom property. There is no composited way to make three siblings
 * share a changing amount of space - any version of this is a layout
 * animation - but the grid does it as one pass over one property on one
 * element, where three transitioning `flex-grow` children give the
 * engine three values to reconcile against each other every frame.
 *
 * ## How the image is revealed
 *
 * Nothing about the image moves, resizes or fades. Its gradient is
 * pinned to a fixed width wider than the panel ever gets
 * (`staticWidth`), and the window it sits in is clipped by the panel's
 * own edge - so the panel growing is the entire reveal. The picture was
 * always there at full strength; the card just stops covering it.
 *
 * Two earlier versions of this were wrong in ways worth naming. The
 * first stretched the image from a fixed left offset to the panel's
 * right edge, so the gradient restretched on every frame and read as
 * the picture being resized. The second kept it static but faded it in,
 * which is a different effect again: a reveal should be the container
 * uncovering something, not the something appearing.
 *
 * ## Why the text column is a fixed width
 *
 * Because anything else re-wraps the paragraph mid-transition. It was
 * `w-full max-w-[19rem]`, which resolves to `min(panel - padding, 19rem)`
 * - about 245px collapsed and 304px open - so the text reflowed on
 * every frame and the panel being left behind appeared to flicker. A
 * fixed width cannot reflow, which also means it has to fit inside a
 * COLLAPSED panel: that is what sets the breakpoint at `xl`.
 *
 * ## Why it is not hover-only
 *
 * A panel that only opens on hover is unreachable by keyboard and does
 * nothing on a touchscreen. Focus opens a panel too, and every panel
 * keeps its link in the tab order whether or not it is open - the
 * alternative, hiding the inactive links, is a focusable element nobody
 * can see. Below `lg` the panels stack and none of this applies.
 */
const ICONS: Record<string, LucideIcon> = {
  single: Store,
  multi: Building2,
  managed: Network,
};

/** The text column's width, and where each panel's image begins. */
const TEXT_WIDTH = "17rem";
/**
 * The image's own width. Deliberately wider than the widest an open
 * panel's image area gets, so the panel is always showing a crop of it
 * and never runs out of picture.
 */
const IMAGE_WIDTH = "34rem";

export function SolutionsAccordion() {
  const [active, setActive] = React.useState(0);

  const columns = SOLUTIONS.items
    .map((_, index) => (index === active ? "2.2fr" : "1fr"))
    .join(" ");

  return (
    <ul
      data-accordion
      className="grid gap-5"
      style={{ "--accordion-cols": columns } as React.CSSProperties}
    >
      {SOLUTIONS.items.map((item, index) => {
        const Icon = ICONS[item.key];

        return (
          <li
            key={item.key}
            data-reveal="panel"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            className="relative flex min-h-[20rem] overflow-hidden rounded-surface bg-raised lg:min-h-[25rem]"
          >
            {/* In flow while the panels are stacked, taken out of it
                once they are side by side: an absolutely positioned
                column cannot be squeezed by its panel, which is what
                guarantees the text never re-wraps mid-transition. */}
            <div
              className="relative z-10 flex w-full flex-col justify-between gap-10 p-7 sm:p-8 xl:absolute xl:inset-y-0 xl:left-0 xl:w-(--text-width)"
              style={{ "--text-width": TEXT_WIDTH } as React.CSSProperties}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
                <Icon className="size-5" />
              </span>

              <div>
                <h3 className="text-lg font-medium tracking-tight">
                  {item.title}
                </h3>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground text-pretty">
                  {item.copy}
                </p>
                <Link
                  href={SOLUTIONS.link.href}
                  className="group mt-6 inline-flex items-center gap-3 text-xs font-medium tracking-[0.08em] text-primary uppercase underline underline-offset-[6px] transition-colors hover:text-foreground"
                >
                  {SOLUTIONS.link.label}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </div>
            </div>

            {/*
              The window the panel opens onto the image.

              Nothing here fades and nothing here has a transition of its
              own. The window's right edge is the panel's, so the panel
              growing IS the window growing, and a wider window simply
              shows more of a picture that was always there at full
              strength. A collapsed panel is narrower than the text
              column, so the window has no width at all and there is
              nothing to see.
            */}
            <div
              className="absolute inset-y-4 right-4 hidden overflow-hidden rounded-3xl xl:block"
              style={{ left: TEXT_WIDTH }}
            >
              {/* The card fills the window so its ground colour covers
                  every pixel of it, while the gradient bodies inside are
                  pinned to `IMAGE_WIDTH` and do not stretch. */}
              <MediaCard
                tone="light"
                seed={index + 1}
                staticWidth={IMAGE_WIDTH}
                className="size-full"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
