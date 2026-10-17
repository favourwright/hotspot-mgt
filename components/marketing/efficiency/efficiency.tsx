import { EFFICIENCY } from "@/lib/landing-content";
import { CONTENT_WIDTHS } from "@/components/system/widths";
import { EfficiencyMotion } from "@/components/marketing/efficiency/efficiency-motion";
import {
  LiveCard,
  PayoutsCard,
  SalesCard,
  StatementCard,
} from "@/components/marketing/efficiency/panels";

/**
 * Section 3, pinned.
 *
 * A uniform, numbered sequence of cards travelling horizontally past a
 * section that holds still. Nothing is anchored: an earlier version kept
 * the claim card stationary and let the rest slide past it, which made
 * that one card a special case and broke the thing the numbers are for.
 * Every card is the same object, every card carries its place in the
 * sequence, and every card moves.
 *
 * Numbers come from position in this list, never written by hand, so
 * inserting or reordering a card cannot leave the sequence wrong.
 *
 * Everything here is written so the section is correct with no
 * JavaScript: the track is a plain stacked column and the section is an
 * ordinary tall block. Pinning is layered on top in
 * `efficiency-motion.tsx` and only on wide screens with motion allowed.
 *
 * ## The measure
 *
 * The section sits outside the page's measured column and lays out its
 * own, the same way section 8 does, so the track can run past both
 * viewport edges. A track that stopped at the container looked like a
 * row that happened to overflow rather than a sequence continuing off
 * the screen.
 *
 * What keeps it from reading as two unrelated things is that the first
 * and last resting positions still line up with the measure the rest of
 * the page uses. That alignment is computed, not repeated as a number:
 * see the padding on the track below.
 */
const CARDS = [StatementCard, SalesCard, LiveCard, PayoutsCard];

export function Efficiency() {
  return (
    <EfficiencyMotion className="pb-20 sm:pb-28">
      <div
        className={`mx-auto flex w-full flex-wrap items-start justify-between gap-6 px-3 sm:px-6 ${CONTENT_WIDTHS.default}`}
      >
        <p
          data-reveal="eyebrow"
          className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({EFFICIENCY.index})</span>
          {EFFICIENCY.eyebrow}
        </p>

        <p data-reveal="aside" className="max-w-[22rem] text-sm leading-relaxed">
          <span className="text-muted-foreground">
            {EFFICIENCY.aside.muted}{" "}
          </span>
          <span className="font-medium">{EFFICIENCY.aside.strong}</span>
        </p>
      </div>

      {/*
        The viewport.

        Scrollable by default, and clipped to `hidden` only by the pin
        itself, in `efficiency-motion.tsx`. That ordering is the whole
        point: with `overflow-hidden` in the markup, anything that stops
        the pin from running - scripting off, a GSAP failure, reduced
        motion - leaves cards 03 and 04 permanently behind a clipped edge
        with no way to reach them. Chrome's scroll anchoring made it
        worse by nudging the clipped container sideways, so card 01 went
        missing too.

        `overflow-x: auto` means the honest fallback is a row the reader
        can simply swipe or scroll. When the pin does run it takes the
        clipping over and the scrollbar goes away with it.

        Below `lg` the cards stack and neither applies, and the viewport
        carries the page's measure instead - the bleed is only wanted for
        the row, not for a stacked column of full-width cards.
      */}
      <div
        data-track-viewport
        className={`mx-auto mt-10 w-full px-3 sm:px-6 lg:max-w-none lg:overflow-x-auto lg:px-0 ${CONTENT_WIDTHS.default}`}
      >
        <div
          data-track
          /*
            The inset at each end is the page gutter, worked out from the
            viewport rather than written down twice.

            A padding percentage resolves against the containing block's
            width, which here is the full-bleed viewport element - so
            `(100% - 1400px) / 2` is exactly the space the centred
            container leaves at one side, and adding the gutter lands on
            the same left edge the header above uses. `max()` covers the
            narrow case, where the container is not centred at all and
            the gutter is the whole inset.

            `100vw` would have been the obvious way to write this and is
            wrong: it includes the scrollbar, so it over-insets by half
            its width and pushes a few pixels of horizontal overflow onto
            the page. A percentage of the layout box does not.

            Both ends, not just the start. The pin stops when the track's
            right edge reaches the viewport's, so without the trailing
            inset the sequence finishes with the last card jammed against
            the edge of the screen.
          */
          className={[
            "flex flex-col gap-5 lg:w-max lg:flex-row lg:items-stretch",
            "lg:ps-[max(1.5rem,calc((100%-1400px)/2+1.5rem))]",
            "lg:pe-[max(1.5rem,calc((100%-1400px)/2+1.5rem))]",
          ].join(" ")}
        >
          {CARDS.map((Card, position) => (
            <div
              key={position}
              data-reveal="card"
              // One width for every card, so the sequence reads as a
              // series rather than as a row of differently important
              // things.
              //
              // Sized against the reference, which fits 1.88 cards in its
              // content width - just under two, so the next card is
              // always cut by the right edge and the track reads as
              // continuing before anything has moved. An earlier 32rem
              // fitted 2.6, which showed most of a third card and made
              // the row look like a grid that happened to overflow.
              //
              // A clamp rather than a fixed width because the container
              // is capped at 1400px: below that the cards should track
              // the viewport to hold the ratio, and above it the cap
              // takes over and a vw-derived width would keep growing past
              // its own container.
              className="lg:w-[clamp(26rem,50vw,44rem)] lg:shrink-0"
            >
              <Card index={String(position + 1).padStart(2, "0")} />
            </div>
          ))}
        </div>
      </div>
    </EfficiencyMotion>
  );
}
