import Link from "next/link";

import { HERO } from "@/lib/landing-content";
import { Button } from "@/components/system/button";
import { CONTENT_WIDTHS } from "@/components/system/widths";
import { HeroBackdrop } from "@/components/marketing/hero/hero-backdrop";
import { HeroMotion } from "@/components/marketing/hero/hero-motion";

/**
 * Section 1.
 *
 * A server component: everything here is markup and copy, and the only
 * JavaScript the section ships is `HeroMotion`, which wraps it.
 *
 * The `data-reveal` attributes are the contract with that wrapper.
 * `landing.css` puts anything carrying one into its start state as part of
 * the server HTML, and the timeline reads the values to decide ordering.
 * An element with no attribute is simply never animated.
 */
export function Hero() {
  return (
    // The same box the nav bar lays itself out in, so the brand mark and
    // the headline start on the same vertical. They are separate components
    // in separate files, which is exactly how two measures drift apart, so
    // both take theirs from `CONTENT_WIDTHS`.
    //
    // The sticky nav occupies its own height at the top of the page.
    // Pulling the hero up by exactly that and padding it back down puts the
    // bar over the hero, as in the reference, while leaving it free to go
    // on sticking over every section below.
    <div
      className={[
        "mx-auto w-full px-2 sm:px-6",
        // Pull up by the bar's height LESS the hero's top inset, so the
        // hero's top edge lands on that inset rather than flush against
        // the top of the viewport.
        "-mt-[calc(var(--nav-height)-var(--hero-top))]",
        CONTENT_WIDTHS.default,
      ].join(" ")}
    >
      <HeroMotion
        className={[
          "overflow-hidden rounded-surface",
          "pt-(--nav-height)",
          "min-h-[36rem] lg:min-h-[42rem]",
        ].join(" ")}
      >
        <HeroBackdrop />

        <div className="relative flex flex-1 flex-col px-5 pt-10 pb-5 sm:px-8 sm:pt-14 sm:pb-8">
          <h1
            data-reveal="headline"
            // Capped in characters as well as in pixels. Left to the
            // viewport alone this sets as one very long line on a wide
            // screen, which loses the stacked, blocky presence the
            // reference gets from letting the headline wrap.
            className="max-w-[15ch] text-[clamp(2.5rem,6vw,5.5rem)] leading-[0.94] font-medium tracking-[-0.04em] text-balance"
          >
            {HERO.headline}
          </h1>

          {/* The one place this page uses a border. The system does without
              them everywhere else, since depth comes from the tint cycle,
              but the cycle cannot draw a line across open space. */}
          {/* Drawn rather than faded. The element IS the rule - a block
              with a top border and no height - so scaling it on X scales
              the line, with no positioned span needed the way section 4's
              cell-edge rules require one. */}
          <div
            data-rule="x"
            className="mt-10 border-t border-dashed border-foreground/20 sm:mt-12"
          />

          <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-16">
            <ul className="flex flex-wrap items-start gap-x-10 gap-y-3">
              {HERO.markers.map((marker) => (
                <li
                  key={marker}
                  data-reveal="marker"
                  className="flex items-center gap-2.5 text-xs font-medium tracking-[0.08em] uppercase"
                >
                  <span className="grid size-3.5 shrink-0 place-items-center rounded-full border-2 border-primary">
                    <span className="size-1 rounded-full bg-primary" />
                  </span>
                  {marker}
                </li>
              ))}
            </ul>

            <div className="lg:text-right">
              <p
                data-reveal="support"
                className="text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
              >
                {HERO.support}
              </p>

              <div
                data-reveal="support"
                // Stacked and full width on a phone. Wrapped to two rows
                // of different widths is what `flex-wrap` gives you for
                // free here, and it reads as an accident.
                className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap lg:justify-end"
              >
                {/* The page's single `action` button. Everything else on
                    this screen is raised, ghost, or the accent pill in the
                    bar above. */}
                <Button
                  tone="action"
                  nativeButton={false}
                  className="h-13 w-full px-7 text-[0.95rem] sm:w-auto"
                  render={<Link href={HERO.actions.primary.href} />}
                >
                  {HERO.actions.primary.label}
                </Button>
                <Button
                  tone="raised"
                  nativeButton={false}
                  className="h-13 w-full px-7 text-[0.95rem] sm:w-auto"
                  render={<Link href={HERO.actions.secondary.href} />}
                >
                  {HERO.actions.secondary.label}
                </Button>
              </div>
            </div>
          </div>

          {/* The backdrop's own region. Nothing renders here; the section
              just reserves the height that makes the hero read as an image
              with text above and below it rather than as a tall gradient. */}
          <div className="min-h-[9rem] flex-1 sm:min-h-[12rem]" />

          <div className="text-white">
            <p
              data-reveal="footer"
              className="text-[0.7rem] font-medium tracking-[0.14em] text-white/65 uppercase"
            >
              {HERO.footer.eyebrow}
            </p>

            <ul
              data-reveal="footer"
              className="mt-3 flex flex-wrap gap-x-8 gap-y-2"
            >
              {HERO.footer.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="text-sm font-medium tracking-[0.04em] uppercase"
                >
                  {capability}
                </li>
              ))}
            </ul>

            <div
              data-rule="x"
              className="mt-6 border-t border-dashed border-white/25"
            />

            <div
              data-reveal="footer"
              className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3"
            >
              <span className="text-[0.7rem] font-medium tracking-[0.14em] text-white/55 uppercase">
                {HERO.footer.worksWithLabel}
              </span>
              {HERO.footer.worksWith.map((name) => (
                <span
                  key={name}
                  className="text-sm font-semibold tracking-tight text-white/90"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </HeroMotion>
    </div>
  );
}
