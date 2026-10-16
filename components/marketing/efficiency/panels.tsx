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
  children,
}: {
  index: string;
  icon?: LucideIcon;
  title?: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex h-full flex-col rounded-surface bg-sunken p-7 sm:p-9">
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

      {/* The card's place in the sequence. Decorative, so it is not a
          heading and is not announced; the content above it is what
          carries meaning. */}
      <p
        aria-hidden
        className="mt-7 text-right text-4xl font-medium tracking-tight text-foreground/70 tabular-nums sm:text-5xl"
      >
        {index}
      </p>
    </article>
  );
}

/** Card 1: the claim the rest of the track supports. */
export function StatementCard({ index }: { index: string }) {
  return (
    <TrackCard index={index}>
      <div className="flex h-full flex-col justify-between gap-10">
        <p className="text-[clamp(1.35rem,2.1vw,1.75rem)] leading-[1.3] tracking-[-0.02em] text-pretty">
          {EFFICIENCY.statement.lead}{" "}
          <span className="text-muted-foreground">
            {EFFICIENCY.statement.rest}
          </span>
        </p>
        <MediaCard seed={2} className="size-28 shrink-0 sm:size-32" />
      </div>
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

  return (
    <TrackCard index={index} icon={Users} title={live.title} caption={live.caption}>
      <div className="h-full rounded-panel bg-raised p-5 sm:p-6">
        <ul aria-hidden className="flex h-full flex-col justify-center gap-6">
          {live.rows.map((row) => (
            <li key={row.name} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm font-medium">{row.name}</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {row.active}
                  <span className="text-muted-foreground/60">
                    {" / "}
                    {row.capacity}
                  </span>
                </span>
              </div>
              {/* The track is a lighter step of the same ramp as the fill,
                  so the state reads across the whole bar rather than only
                  where it happens to end. */}
              <div className="h-1.5 overflow-hidden rounded-full bg-primary/12">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(row.active / row.capacity) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
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
      <div className="h-full rounded-panel bg-raised p-5 sm:p-6">
        <div aria-hidden className="flex h-full flex-col justify-center gap-7">
          <div>
            <p className="text-xs tracking-[0.1em] text-muted-foreground uppercase">
              {payouts.totalLabel}
            </p>
            {/* The one large figure here, in the same sans as everything
                else. Proportional figures, not tabular: tabular widths
                make a standalone number at this size read loose. */}
            <p className="mt-1 text-4xl font-medium tracking-tight">
              {payouts.total}
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {payouts.rows.map((row) => (
              <li
                key={row.label}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </li>
            ))}
          </ul>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {payouts.note}
          </p>
        </div>
      </div>
    </TrackCard>
  );
}
