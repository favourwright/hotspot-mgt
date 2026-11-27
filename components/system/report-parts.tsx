"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { monthName, type MonthKey } from "@/lib/stats-period";
import { Button } from "@/components/system/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** `2026-11` as `November 2026`. */
export function monthLabel(month: MonthKey): string {
  return `${monthName(month)} ${month.slice(0, 4)}`;
}

/**
 * Which month a report shows, kept in the URL (`?month=2026-10`) so a
 * reload or a shared link lands on the same month. Changing it is a
 * navigation: the server reads the month and renders it.
 */
export function useReportMonth() {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const go = React.useCallback(
    (month: MonthKey, current: MonthKey) => {
      const next = new URLSearchParams(params.toString());
      if (month === current) next.delete("month");
      else next.set("month", month);
      const query = next.toString();
      startTransition(() => router.push(query ? `?${query}` : "?", { scroll: false }));
    },
    [params, router]
  );
  return { go, pending };
}

/** The page's one filter: the month. Newest first. */
export function MonthPicker({
  months,
  value,
  current,
  onChange,
}: {
  months: MonthKey[];
  value: MonthKey;
  current: MonthKey;
  onChange: (month: MonthKey) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button tone="raised" scale="sm" />}
        className="w-52 shrink-0 justify-between"
      >
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          {monthLabel(value)}
        </span>
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => v && onChange(v as MonthKey)}>
          {[...months].reverse().map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              {monthLabel(m)}
              {m === current && <span className="ml-auto text-xs text-muted-foreground">So far</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface MixPart {
  key: string;
  label: string;
  color: string;
  value: number;
  /**
   * The share printed inside the part: white on the deep hues (magenta,
   * blue), near-black on the light ones (aqua, yellow), where white fails.
   */
  ink?: "light" | "dark";
}

/**
 * One whole split into its parts: a tall segmented bar with each part's
 * share printed inside where it fits, and the parts listed underneath with
 * their amounts. Parts at zero draw nothing in the bar but stay in the list,
 * so "no cash this month" is said rather than implied.
 */
export function MixBar({
  parts,
  format,
}: {
  parts: MixPart[];
  format: (v: number) => string;
}) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="img"
        aria-label={
          total > 0
            ? parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")
            : "Nothing to split"
        }
        className="flex h-7 w-full gap-0.5 overflow-hidden rounded-md bg-(--inset-bg)"
      >
        {total > 0 ? (
          shown.map((p) => {
            const share = p.value / total;
            const pct = Math.round(share * 100);
            return (
              <div
                key={p.key}
                className="flex h-full min-w-0.5 items-center rounded-[4px] px-2"
                style={{ flexGrow: share, flexBasis: 0, background: p.color }}
              >
                {/* Printed only where it fits; the list below always has it. */}
                {share >= 0.12 && (
                  <span
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      p.ink === "dark" ? "text-neutral-900" : "text-white"
                    )}
                  >
                    {pct}%
                  </span>
                )}
              </div>
            );
          })
        ) : (
          <div className="h-full w-full rounded-[4px] bg-muted" />
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
              {p.label}
            </span>
            <span className="tabular-nums">
              {format(p.value)}
              {total > 0 && (
                <span className="ml-2 inline-block w-10 text-right text-muted-foreground">
                  {Math.round((p.value / total) * 100)}%
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A label and a figure, as a quiet row under the mix. */
export function FactList({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return (
    <dl className="flex flex-col gap-2 border-t border-border/60 pt-4 text-sm">
      {facts.map((f) => (
        <div key={f.label} className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{f.label}</dt>
          <dd className="tabular-nums">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportCard({
  title,
  description,
  children,
  className,
  inset = true,
  fill,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  inset?: boolean;
  /** Grow the panel to the card's height, for a card stretched by its row. */
  fill?: boolean;
}) {
  return (
    <SurfaceCard className={className}>
      <SurfaceCardHeader>
        <SurfaceCardTitle>{title}</SurfaceCardTitle>
        {description && <SurfaceCardDescription>{description}</SurfaceCardDescription>}
      </SurfaceCardHeader>
      <SurfaceCardContent inset={inset} className={cn(fill && "flex-1")}>
        {children}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}

/**
 * Day by day, newest first, with the month's totals in the footer. The
 * chart's text twin: every value the charts show on hover is here.
 */
export function DayTable({
  columns,
  rows,
  footer,
}: {
  columns: string[];
  rows: Array<{ key: string; cells: string[]; muted?: boolean }>;
  footer?: string[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((c, i) => (
            <TableHead key={c} className={i > 0 ? "text-right" : undefined}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key} className={cn(r.muted && "text-muted-foreground")}>
            {r.cells.map((cell, i) => (
              <TableCell key={i} className={i > 0 ? "text-right tabular-nums" : "whitespace-nowrap"}>
                {cell}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer && (
        <TableFooter>
          <TableRow>
            {footer.map((cell, i) => (
              <TableCell
                key={i}
                className={cn("font-medium", i > 0 ? "text-right tabular-nums" : undefined)}
              >
                {cell}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
}
