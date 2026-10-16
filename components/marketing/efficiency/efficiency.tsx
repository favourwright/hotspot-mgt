import { EFFICIENCY } from "@/lib/landing-content";
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
 */
const CARDS = [StatementCard, SalesCard, LiveCard, PayoutsCard];

export function Efficiency() {
  return (
    <EfficiencyMotion className="pb-20 sm:pb-28">
      <div className="flex flex-wrap items-start justify-between gap-6">
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

        Below `lg` the cards stack and neither applies.
      */}
      <div data-track-viewport className="mt-10 lg:overflow-x-auto">
        <div
          data-track
          className="flex flex-col gap-5 lg:w-max lg:flex-row lg:items-stretch"
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
