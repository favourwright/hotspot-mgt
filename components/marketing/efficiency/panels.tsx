import type { LucideIcon } from "lucide-react";
import { ChartNoAxesColumn, Users, Wallet } from "lucide-react";

import { EFFICIENCY } from "@/lib/landing-content";
import { MediaCard } from "@/components/marketing/media-card";
import { SalesChart } from "@/components/marketing/efficiency/sales-chart";

/**
 * One card in section 3's track.
 *
 * Every card is the same object: same width, same height, same tinted
 * surface, same padding, and its own number set large and quiet at the
 * bottom right. Only the content inside differs.
 *
 * The uniformity is the point rather than a convenience. The number is
 * what tells you the track is a sequence you are moving along, and a
 * number only reads that way if every card carries one in the same place
 * - the moment one card is a different shape, it stops being item three
 * of four and starts being a special case. The reference makes this
 * visible by showing a card numbered 02 as the leftmost thing on screen:
 * 01 has already travelled off, which only makes sense if they are a
 * uniform series.
 *
 * `index` is assigned by position where the cards are listed, never
 * written by hand, so the sequence cannot drift out of order when one is
 * inserted or moved.
 */
export function TrackCard({
  index,
  icon: Icon,
  title,
  caption,
  footer,
  children,
}: {
  index: string;
  icon?: LucideIcon;
  title?: string;
  caption?: string;
  /**
   * Optional content sharing the number's row, to its left. The number
   * stays in exactly the same place on every card either way, which is
   * the part that has to stay uniform; what sits beside it does not.
   */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="flex h-full min-h-[22rem] flex-col rounded-surface bg-sunken p-7 sm:p-9 lg:min-h-[28rem]">
      {title && (
        <header className="flex items-center gap-4">
          {Icon && (
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground text-background">
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className="truncate text-lg font-medium tracking-tight sm:text-xl">
              {title}
            </h3>
            {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
          </div>
        </header>
      )}

      <div className={title ? "mt-7 flex-1" : "flex-1"}>{children}</div>

      {/* The card's place in the sequence, with whatever the card wants
          beside it. Decorative, so it is not a heading and is not
          announced; the content above it is what carries meaning. */}
      {/*
        `leading-none` on the number is what makes the card's padding
        read as even. A display-size figure carries a line box well
        taller than its glyphs, so with normal leading the gap under it
        measures the same as the gap above but LOOKS larger - the eye
        reads from the baseline, not from the box. Trimming the line box
        to the glyphs was most of what made these cards feel too tall;
        the rest was the figure simply being oversized for its job here,
        since it is a marker rather than a headline.
      */}
      <footer className="mt-6 flex items-end justify-between gap-6">
        <div className="min-w-0">{footer}</div>
        <p
          aria-hidden
          className="shrink-0 text-3xl leading-none font-medium tracking-tight text-foreground/70 tabular-nums sm:text-4xl"
        >
          {index}
        </p>
      </footer>
    </article>
  );
}

/** Card 1: the claim the rest of the track supports. */
export function StatementCard({ index }: { index: string }) {
  return (
    <TrackCard
      index={index}
      footer={<MediaCard seed={2} className="size-24 sm:size-28" />}
    >
      <p className="text-[clamp(1.35rem,2.1vw,1.75rem)] leading-[1.3] tracking-[-0.02em] text-pretty">
        {EFFICIENCY.statement.lead}{" "}
        <span className="text-muted-foreground">
          {EFFICIENCY.statement.rest}
        </span>
      </p>
    </TrackCard>
  );
}

export function SalesCard({ index }: { index: string }) {
  return (
    <TrackCard
      index={index}
      icon={ChartNoAxesColumn}
      title={EFFICIENCY.chart.title}
    >
      <div className="h-full rounded-panel bg-raised p-5 sm:p-6">
        <SalesChart />
      </div>
    </TrackCard>
  );
}

export function LiveCard({ index }: { index: string }) {
  const { live } = EFFICIENCY.panels;
  // Bars are proportional to the busiest venue, which is a comparison
  // the data supports, rather than to an invented capacity.
  const busiest = Math.max(...live.rows.map((row) => row.active));

  return (
    <TrackCard
      index={index}
      icon={Users}
      title={live.title}
      caption={live.caption}
    >
      <div
        aria-hidden
        className="flex h-full flex-col gap-6 rounded-panel bg-raised p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
              {live.totalLabel}
            </p>
            {/* The card's one large figure. Proportional digits, since a
                standalone number at this size reads loose when every
                digit is padded to the width of a zero. */}
            <p className="mt-1 text-4xl leading-none font-medium tracking-tight">
              {live.total}
            </p>
          </div>
          {/* Static rather than pulsing. A dot that throbs forever is one
              more always-running animation on a page that already pauses
              its backdrop off-screen for exactly that reason, and the
              word beside it does the same job. */}
          <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <span className="size-2 rounded-full bg-primary ring-4 ring-primary/15" />
            Live
          </span>
        </div>

        <ul className="flex flex-col gap-4">
          {live.rows.map((row) => (
            <li key={row.name} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                  {row.active}
                </span>
              </div>
              {/* The track is a lighter step of the same ramp as the fill,
                  so the state reads across the whole bar rather than only
                  where it happens to end. */}
              <div className="h-1.5 overflow-hidden rounded-full bg-black/5">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(row.active / busiest) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-auto text-xs text-muted-foreground">
          {live.footnote}
        </p>
      </div>
    </TrackCard>
  );
}

export function PayoutsCard({ index }: { index: string }) {
  const { payouts } = EFFICIENCY.panels;

  return (
    <TrackCard
      index={index}
      icon={Wallet}
      title={payouts.title}
      caption={payouts.caption}
    >
      <div
        aria-hidden
        className="flex h-full flex-col gap-6 rounded-panel bg-raised p-5 sm:p-6"
      >
        <div>
          <p className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
            {payouts.totalLabel}
          </p>
          <p className="mt-1 text-4xl leading-none font-medium tracking-tight">
            {payouts.total}
          </p>
        </div>

        {/*
          Part-to-whole as one split bar. The sales card already owns the
          column form, and a second chart of the same shape in the same
          track reads as one idea repeated rather than two facts.

          The 2px gap between the segments is the surface doing the
          separating, which is the house rule for touching marks - no
          stroke is drawn around either.
        */}
        <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
          {payouts.split.map((part, index) => (
            <span
              key={part.label}
              className={index === 0 ? "bg-primary" : "bg-black/10"}
              style={{ width: `${part.percent}%` }}
            />
          ))}
        </div>

        <ul className="flex flex-col gap-3">
          {payouts.split.map((part, index) => (
            <li
              key={part.label}
              className="flex items-baseline justify-between gap-4 text-sm"
            >
              {/* A swatch matching the segment, so which row is which
                  never depends on reading the bar's colour alone. */}
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    index === 0 ? "bg-primary" : "bg-black/10"
                  }`}
                />
                <span className="truncate text-muted-foreground">
                  {part.label}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {part.value}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-auto text-xs leading-relaxed text-muted-foreground">
          {payouts.note}
        </p>
      </div>
    </TrackCard>
  );
}
