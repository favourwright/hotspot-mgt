import { EFFICIENCY } from "@/lib/landing-content";

/**
 * An illustration of the owner's dashboard, built to the rules a real
 * chart follows.
 *
 * It is `aria-hidden` and has no hover layer, which is a deliberate
 * departure from the house default of shipping interactivity with any
 * HTML chart. The default assumes the chart is a data display; this is a
 * picture of one, with invented numbers, and a tooltip over invented
 * numbers is a lie with a hover state. The copy beside it carries the
 * meaning for anyone who cannot see it.
 *
 * Where it follows the rules, and why each one shows:
 *
 * - **The axis starts at zero.** The reference's starts at 50%, which is
 *   the one thing a bar chart may never do: bar length *is* the value, so
 *   a truncated baseline misstates every bar in proportion.
 * - **Gridlines are solid hairlines.** The reference dashes them. Dashing
 *   reads as "threshold", which is why the average line below is dashed
 *   and the grid is not.
 * - **One series, so no legend.** The panel's own label names it.
 * - **One direct label, on the peak.** A value on every column is noise;
 *   the axis carries the rest.
 * - **Emphasis, not a palette.** The story is one month, so that column
 *   takes the accent and the others drop to a recessive neutral. Colouring
 *   all nine would spend the identity channel re-encoding what height
 *   already shows.
 * - **Text never wears the data colour.** Axis and labels are text tokens
 *   throughout; only the marks are accented.
 */
export function SalesChart() {
  const { chart } = EFFICIENCY;
  const peak = chart.points.reduce((a, b) => (b.value > a.value ? b : a));

  const asPercent = (value: number) => (value / chart.axisMax) * 100;

  return (
    <div aria-hidden className="flex flex-col gap-7">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium">{chart.series}</p>
        <p className="text-xs text-muted-foreground">{chart.period}</p>
      </div>

      <div className="flex gap-3">
        {/*
          The y axis is positioned, not distributed. `justify-between` on a
          flex column aligns each label's BOX to the track's ends, so the
          top and bottom labels sit a half-line off their gridlines. Giving
          them the same `bottom` percentage as the lines and centring them
          on it is the only way the two agree at every tick.

          `tabular-nums` because this is a column of numbers that has to
          align vertically; the rest of the page uses proportional figures.
        */}
        <div className="relative h-44 w-7 shrink-0">
          {chart.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-[0.65rem] leading-none text-muted-foreground tabular-nums"
              style={{ bottom: `${asPercent(tick)}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        {/* The plot and its month labels share this column, so a label is
            always under its own bar whatever the axis width turns out to
            be. */}
        <div className="min-w-0 flex-1">
          <div className="relative h-44">
            {/* Gridlines: hairline, solid, one step off the surface. */}
            {chart.ticks.map((tick) => (
              <span
                key={tick}
                className="absolute inset-x-0 h-px bg-border"
                style={{ bottom: `${asPercent(tick)}%` }}
              />
            ))}

            {/* The average. Dashed on purpose: it is a threshold, not a
                gridline, and dashing is what distinguishes the two. */}
            <span
              className="absolute inset-x-0 h-0 border-t border-dashed border-foreground/35"
              style={{ bottom: `${asPercent(chart.average)}%` }}
            />
            <span
              className="absolute left-0 z-10 -translate-y-1/2 rounded-full bg-foreground px-2 py-0.5 text-[0.6rem] font-medium text-background tabular-nums"
              style={{ bottom: `${asPercent(chart.average)}%` }}
            >
              Avg {chart.average}
            </span>

            {/* The columns. `gap-[2px]` is the surface gap that separates
                touching marks; nothing is stroked. */}
            <div className="absolute inset-0 flex items-end gap-[2px]">
              {chart.points.map((point) => {
                const isPeak = point.label === peak.label;
                return (
                  <div
                    key={point.label}
                    className="relative flex h-full flex-1 justify-center"
                  >
                    <div
                      data-bar
                      // Capped rather than filling the slot, so the band's
                      // leftover stays as air. Rounded at the data end,
                      // square at the baseline.
                      className={`absolute bottom-0 w-full max-w-6 rounded-t-[4px] ${
                        isPeak ? "bg-primary" : "bg-foreground/12"
                      }`}
                      style={{ height: `${asPercent(point.value)}%` }}
                    />
                    {isPeak && (
                      <span
                        className="absolute z-10 -translate-y-full rounded-full bg-primary px-2 py-0.5 text-[0.6rem] font-medium text-primary-foreground tabular-nums"
                        style={{
                          bottom: `calc(${asPercent(point.value)}% + 6px)`,
                        }}
                      >
                        {point.value}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex gap-[2px]">
            {chart.points.map((point) => (
              <span
                key={point.label}
                className="min-w-0 flex-1 text-center text-[0.65rem] text-muted-foreground"
              >
                {point.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
