"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";

/**
 * A chart in a card, for an overview page.
 *
 * The chart is a glance. Its figures, day by day, live on the report page
 * the card links to, which is also the chart's accessible equivalent: every
 * value the hover readout shows is in that page's table, so nothing is
 * hover-only, and the two light-mode series hues that sit under 3:1 against
 * the panel are backed by text there.
 *
 * `refreshing` holds the previous render at reduced opacity while the
 * figures reload, rather than flashing a skeleton.
 */
export function TrendCard({
  title,
  description,
  legend,
  chart,
  href,
  hrefLabel = "View report",
  empty,
  refreshing,
  className,
}: {
  title: string;
  description: string;
  legend?: React.ReactNode;
  chart: React.ReactNode;
  /** Where the full figures are. Omit on the page that has them. */
  href?: string;
  hrefLabel?: string;
  /** When set, the card shows this instead of an empty chart. */
  empty?: { icon: React.ReactNode; title: string; description: string } | null;
  refreshing?: boolean;
  className?: string;
}) {
  return (
    <SurfaceCard
      className={className}
      // Not stretched: the chart under the header has its own hover and
      // keyboard reading, which a whole-card link would swallow.
      action={href ? { label: hrefLabel, href, stretch: false } : undefined}
    >
      <SurfaceCardHeader>
        <SurfaceCardTitle>{title}</SurfaceCardTitle>
        <SurfaceCardDescription>{description}</SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent
        className={cn("transition-opacity duration-200", refreshing && "opacity-60")}
      >
        {empty ? (
          // The chart view's own height (legend row, gap, 244px chart with
          // its axis band), so a card with no data lines up with its pair.
          <Empty className="h-68">
            <EmptyHeader>
              <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
              <EmptyTitle>{empty.title}</EmptyTitle>
              <EmptyDescription>{empty.description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Always one row tall, legend or not: a single series needs no
                legend (the title names it), but the chart keeps its place. */}
            <div className="min-h-4">{legend}</div>
            {chart}
          </div>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
