"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Trend charts, drawn as plain SVG.
 *
 * No chart library: the two forms the dashboards need (stacked columns and
 * a pair of lines) are a few hundred lines, and a library would bring its
 * own idea of every spec below. The specs are the data-viz house rules:
 *
 *  - thin marks: columns at most 24px wide with a 4px rounded top and a
 *    square baseline, 2px lines, end dots of r=4 inside a 2px ring the
 *    colour of the panel;
 *  - a 2px panel-coloured gap between stacked segments, never a border;
 *  - hairline solid gridlines one step off the panel, never dashed;
 *  - text in text colours only, never in a series colour, the series being
 *    keyed by a swatch beside it;
 *  - selective direct labels (the extreme, the endpoints), never a number
 *    on every mark;
 *  - a hover layer that finds the x for the reader and lists every series
 *    there, the same on keyboard focus (arrow keys) as on hover;
 *  - a missing day drawn as a gap, never as zero.
 *
 * Every colour is set through `style`, never a presentation attribute:
 * Safari does not resolve `var()` in `fill="..."`/`stroke="..."`, so the
 * first version drew black columns and no lines there while Chromium looked
 * perfect.
 *
 * Colours come from `--series-*` in globals.css, picked and checked for
 * colour-blind separation in both modes. Every chart sits beside a table
 * view (`ChartTable`), which is what makes the two low-contrast light-mode
 * hues acceptable and what makes no value hover-only.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** A CSS colour, normally `var(--series-n)`. */
  color: string;
}

const PLOT_HEIGHT = 200;
const TOP = 20; // room for a direct label above the tallest mark
const AXIS_BAND = 24; // x tick labels, inside the chart's own height
const LEFT = 48; // y tick labels
const RIGHT = 12;
const HEIGHT = TOP + PLOT_HEIGHT + AXIS_BAND;

/* ----------------------------------------------------------------- helpers */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Round ticks from zero, covering `max`: 0 / 50K / 100K / 150K. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Rough width of an 11px axis label, for collision checks. */
const labelWidth = (text: string) => text.length * 6.2;

/**
 * Every nth index so labels stay at least `minGap` px apart, always ending
 * on the last. The last label is anchored at its end (it sits at the plot's
 * right edge), so it reaches further left than a centred one: when it would
 * run into its neighbour, the neighbour goes rather than the newest point.
 */
function tickIndexes(
  count: number,
  spacing: number,
  label: (i: number) => string,
  minGap = 56
): number[] {
  const every = Math.max(1, Math.ceil(minGap / Math.max(spacing, 1)));
  const out: number[] = [];
  // Counted back from the end, so the most recent point is always labelled.
  for (let i = count - 1; i >= 0; i -= every) out.unshift(i);
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    const room = (last - prev) * spacing;
    if (room < labelWidth(label(last)) + labelWidth(label(prev)) / 2 + 8) out.splice(-2, 1);
  }
  return out;
}

/** The plot's hairline grid and y ticks. */
function YAxis({
  ticks,
  y,
  width,
  format,
}: {
  ticks: number[];
  y: (v: number) => number;
  width: number;
  format: (v: number) => string;
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={LEFT}
            x2={width - RIGHT}
            y1={y(t)}
            y2={y(t)}
            style={{ stroke: "var(--chart-grid)" }}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            x={LEFT - 8}
            y={y(t)}
            dy="0.32em"
            textAnchor="end"
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** The hover readout: values lead, series names follow, line keys. */
function Tooltip({
  x,
  width,
  title,
  rows,
  footnote,
}: {
  x: number;
  width: number;
  title: string;
  rows: Array<{ key: string; label: string; color?: string; value: string }>;
  footnote?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(160);
  // Measured so it can flip sides at the right edge; `rows.length` and the
  // title are what change its width.
  React.useLayoutEffect(() => {
    if (ref.current) setW(ref.current.offsetWidth);
  }, [title, rows.length]);
  // Beside the pointer, flipped to the other side near the right edge.
  const left = x + 12 + w > width ? Math.max(0, x - 12 - w) : x + 12;
  return (
    <div
      ref={ref}
      role="presentation"
      className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-xl bg-foreground px-3 py-2 text-xs text-background shadow-sm"
      style={{ left }}
    >
      <div className="mb-1.5 text-background/70">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2">
            {r.color ? (
              <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="font-semibold tabular-nums">{r.value}</span>
            <span className="text-background/70">{r.label}</span>
          </div>
        ))}
      </div>
      {footnote && <div className="mt-1.5 text-background/60">{footnote}</div>}
    </div>
  );
}

/** Keyboard reading: arrows move the readout, Escape clears it. */
function useKeyboardIndex(count: number, setIndex: React.Dispatch<React.SetStateAction<number | null>>) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setIndex((i) => Math.min(count - 1, Math.max(0, (i ?? (step > 0 ? -1 : count)) + step)));
    } else if (e.key === "Home") {
      setIndex(0);
    } else if (e.key === "End") {
      setIndex(count - 1);
    } else if (e.key === "Escape") {
      setIndex(null);
    }
  };
}

/* ------------------------------------------------------------------ legend */

export function ChartLegend({
  series,
  shape,
  className,
}: {
  series: Array<ChartSeries & { muted?: boolean }>;
  /** Mirrors the mark: a block for columns, a stroke for lines. */
  shape: "block" | "line";
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={shape === "block" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full"}
            style={{ background: s.color }}
          />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- column chart */

export interface ColumnPoint {
  key: string;
  /** Full name for the readout and the table: "Thu 27 Nov". */
  label: string;
  /** Short name under the axis: "27 Nov", "Today". */
  tick: string;
  /** Null for a point with no data yet: drawn as nothing. */
  values: Record<string, number> | null;
  /** Shown in the readout, e.g. "So far today". */
  note?: string;
}

export function ColumnChart({
  points,
  series,
  format,
  axisFormat,
  ariaLabel,
  selected,
  onSelect,
  minTickGap = 64,
  className,
}: {
  points: ColumnPoint[];
  /** Least room, in px, between x labels. Lower for short labels ("Nov"). */
  minTickGap?: number;
  /** Bottom to top. */
  series: ChartSeries[];
  /** A column shown as the current one; the others recede. */
  selected?: number;
  /** Makes each column a choice: click, or Enter on the keyboard. */
  onSelect?: (index: number) => void;
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);
  const moveWithKeys = useKeyboardIndex(points.length, setActive);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (onSelect && active !== null && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onSelect(active);
      return;
    }
    moveWithKeys(e);
  };

  const total = (p: ColumnPoint) =>
    p.values ? series.reduce((s, sr) => s + (p.values![sr.key] ?? 0), 0) : 0;
  const totals = points.map(total);
  const max = Math.max(0, ...totals);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => TOP + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;

  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const band = points.length ? plotWidth / points.length : 0;
  const barWidth = Math.max(2, Math.min(24, band * 0.62));
  const cx = (i: number) => LEFT + band * i + band / 2;
  const peak = totals.indexOf(max);

  const activePoint = active !== null ? points[active] : null;

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className={cn(
            "block overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            onSelect && active !== null && points[active]?.values && "cursor-pointer"
          )}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          onClick={() => {
            if (onSelect && active !== null && points[active]?.values) onSelect(active);
          }}
          onPointerMove={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const i = Math.floor((x - LEFT) / band);
            setActive(i >= 0 && i < points.length ? i : null);
          }}
        >
          <YAxis ticks={ticks} y={y} width={width} format={axisFormat} />

          {points.map((p, i) => {
            if (!p.values) return null;
            // Bottom up, skipping empty segments so the rounded top always
            // lands on the segment that is actually on top.
            const parts = series
              .map((s) => ({ s, v: p.values![s.key] ?? 0 }))
              .filter((part) => part.v > 0);
            let base = 0;
            // Hover leads; otherwise the selected column, if any, does.
            const focus = active ?? selected ?? null;
            const dim = focus !== null && focus !== i;
            return (
              <g
                key={p.key}
                className="transition-opacity duration-150"
                opacity={dim ? 0.45 : 1}
              >
                {parts.map((part, j) => {
                  const y0 = y(base);
                  base += part.v;
                  const y1 = y(base);
                  // The 2px gap: every segment above the first gives up its
                  // bottom two pixels to the panel colour behind it.
                  const gap = j > 0 ? 2 : 0;
                  const h = Math.max(0, y0 - y1 - gap);
                  const isTop = j === parts.length - 1;
                  return (
                    <path
                      key={part.s.key}
                      d={columnPath(cx(i) - barWidth / 2, y1, barWidth, h, isTop ? Math.min(4, h, barWidth / 2) : 0)}
                      style={{ fill: part.s.color }}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* One direct label: the best day. */}
          {max > 0 && peak >= 0 && (
            <text
              x={cx(peak)}
              y={y(max) - 6}
              textAnchor={peak > points.length - 3 ? "end" : peak < 2 ? "start" : "middle"}
              className="fill-foreground text-[11px] font-medium tabular-nums"
              aria-hidden
            >
              {axisFormat(max)}
            </text>
          )}

          {/* X ticks. */}
          <g aria-hidden>
            {tickIndexes(points.length, band, (i) => points[i].tick, minTickGap).map((i) => (
              <text
                key={points[i].key}
                x={cx(i)}
                y={TOP + PLOT_HEIGHT + 16}
                textAnchor={i === points.length - 1 ? "end" : "middle"}
                className={cn(
                  "text-[11px]",
                  i === (active ?? selected) ? "fill-foreground font-medium" : "fill-muted-foreground"
                )}
              >
                {points[i].tick}
              </text>
            ))}
          </g>
        </svg>
      )}

      {activePoint && active !== null && (
        <Tooltip
          x={cx(active)}
          width={width}
          title={activePoint.label}
          rows={
            activePoint.values
              ? [
                  ...[...series].reverse().map((s) => ({
                    key: s.key,
                    label: s.label,
                    color: s.color,
                    value: format(activePoint.values![s.key] ?? 0),
                  })),
                  ...(series.length > 1
                    ? [{ key: "__total", label: "Total", value: format(totals[active]) }]
                    : []),
                ]
              : [{ key: "__none", label: "", value: "Not tallied yet" }]
          }
          footnote={activePoint.note}
        />
      )}
    </div>
  );
}

/** A column with only its top corners rounded: square on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  if (r <= 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/* ------------------------------------------------------------- line chart */

export interface LineSeries extends ChartSeries {
  /** One value per x position; null breaks the line. */
  values: Array<number | null>;
  /** The series the chart is about: drawn over a soft wash, end-labelled. */
  emphasis?: boolean;
}

export function LineChart({
  series,
  count,
  tick,
  pointLabel,
  format,
  axisFormat,
  ariaLabel,
  className,
}: {
  series: LineSeries[];
  /** How many x positions the axis spans. */
  count: number;
  /** Axis label for position i. */
  tick: (i: number) => string;
  /** Readout title for position i. */
  pointLabel: (i: number) => string;
  format: (v: number) => string;
  axisFormat: (v: number) => string;
  ariaLabel: string;
  className?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);
  const onKeyDown = useKeyboardIndex(count, setActive);
  // React's ids contain colons, which a `url(#...)` reference does not
  // reliably accept across browsers.
  const gradientId = `trend${React.useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const max = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => TOP + PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const x = (i: number) => LEFT + (count > 1 ? (plotWidth * i) / (count - 1) : plotWidth / 2);

  // Drawn muted first, so the emphasised line sits on top where they cross.
  const ordered = [...series].sort((a, b) => Number(Boolean(a.emphasis)) - Number(Boolean(b.emphasis)));

  const ends = series.map((s) => {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] === null) i -= 1;
    return i >= 0 ? { i, v: s.values[i] as number } : null;
  });

  // End labels: the emphasised series always; the others only where they
  // would not collide with it. Stacking colliding labels detaches them from
  // their lines, so a collision drops the label to the readout instead.
  const emphasisIndex = series.findIndex((s) => s.emphasis);
  const emphasisEnd = emphasisIndex >= 0 ? ends[emphasisIndex] : null;
  const endLabels = series
    .map((s, k) => ({ s, end: ends[k], k }))
    .filter(({ end, k }) => {
      if (!end) return false;
      if (k === emphasisIndex || !emphasisEnd) return true;
      return (
        Math.abs(x(end.i) - x(emphasisEnd.i)) > 72 || Math.abs(y(end.v) - y(emphasisEnd.v)) > 18
      );
    });

  return (
    <div ref={ref} className={cn("relative w-full", className)} style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
          tabIndex={0}
          className="block overflow-visible rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
          onPointerLeave={() => setActive(null)}
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const i = Math.round(((px - LEFT) / Math.max(plotWidth, 1)) * (count - 1));
            setActive(px < LEFT - 8 ? null : Math.min(count - 1, Math.max(0, i)));
          }}
        >
          <defs>
            {series
              .filter((s) => s.emphasis)
              .map((s) => (
                <linearGradient key={s.key} id={`${gradientId}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.16 }} />
                  <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.02 }} />
                </linearGradient>
              ))}
          </defs>

          <YAxis ticks={ticks} y={y} width={width} format={axisFormat} />

          {/* The crosshair finds the day; nobody has to aim at a 2px line. */}
          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={TOP}
              y2={TOP + PLOT_HEIGHT}
              style={{ stroke: "var(--muted-foreground)" }}
              strokeOpacity={0.5}
              strokeWidth={1}
              shapeRendering="crispEdges"
              aria-hidden
            />
          )}

          {ordered.map((s) => {
            const runs = segments(s.values);
            return (
              <g key={s.key} aria-hidden>
                {s.emphasis &&
                  runs.map((run, r) => (
                    <path
                      key={`area-${r}`}
                      d={
                        `M${x(run[0].i)},${y(0)} ` +
                        run.map((p) => `L${x(p.i)},${y(p.v)}`).join(" ") +
                        ` L${x(run[run.length - 1].i)},${y(0)} Z`
                      }
                      fill={`url(#${gradientId}-${s.key})`}
                    />
                  ))}
                {runs.map((run, r) => (
                  <path
                    key={`line-${r}`}
                    d={run.map((p, j) => `${j ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ")}
                    fill="none"
                    style={{ stroke: s.color }}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </g>
            );
          })}

          {/* End dots, ringed in the panel colour so they read on a line. */}
          {series.map((s, k) => {
            const end = ends[k];
            if (!end) return null;
            return (
              <circle
                key={s.key}
                cx={x(end.i)}
                cy={y(end.v)}
                r={4}
                style={{ fill: s.color, stroke: "var(--inset-bg)" }}
                strokeWidth={2}
                aria-hidden
              />
            );
          })}

          {/* The value at the active day, on every series that has one. */}
          {active !== null &&
            series.map((s) => {
              const v = s.values[active];
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={`active-${s.key}`}
                  cx={x(active)}
                  cy={y(v)}
                  r={4}
                  style={{ fill: s.color, stroke: "var(--inset-bg)" }}
                  strokeWidth={2}
                  aria-hidden
                />
              );
            })}

          {endLabels.map(({ s, end }) => {
            const nearRight = x(end!.i) > width - RIGHT - 80;
            return (
              <text
                key={`label-${s.key}`}
                x={x(end!.i) + (nearRight ? -8 : 8)}
                y={y(end!.v) - 10}
                textAnchor={nearRight ? "end" : "start"}
                className={cn(
                  "text-[11px] tabular-nums",
                  s.emphasis ? "fill-foreground font-semibold" : "fill-muted-foreground"
                )}
                aria-hidden
              >
                {axisFormat(end!.v)}
              </text>
            );
          })}

          <g aria-hidden>
            {tickIndexes(count, plotWidth / Math.max(count - 1, 1), tick, 40).map((i) => (
              <text
                key={i}
                x={x(i)}
                y={TOP + PLOT_HEIGHT + 16}
                textAnchor={i === 0 ? "start" : i === count - 1 ? "end" : "middle"}
                className={cn("text-[11px]", i === active ? "fill-foreground" : "fill-muted-foreground")}
              >
                {tick(i)}
              </text>
            ))}
          </g>
        </svg>
      )}

      {active !== null && (
        <Tooltip
          x={x(active)}
          width={width}
          title={pointLabel(active)}
          // The emphasised series first: it is the one being read.
          rows={[...ordered].reverse().map((s) => {
            const v = s.values[active];
            return {
              key: s.key,
              label: s.label,
              color: s.color,
              value: v === null || v === undefined ? "-" : format(v),
            };
          })}
        />
      )}
    </div>
  );
}

/** Unbroken runs of known values. */
function segments(values: Array<number | null>): Array<Array<{ i: number; v: number }>> {
  const runs: Array<Array<{ i: number; v: number }>> = [];
  let run: Array<{ i: number; v: number }> = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ i, v });
    }
  });
  if (run.length) runs.push(run);
  return runs;
}
