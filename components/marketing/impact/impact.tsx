import { cn } from "@/lib/utils";
import { IMPACT } from "@/lib/landing-content";
import { ImpactMotion } from "@/components/marketing/impact/impact-motion";

/**
 * Section 4.
 *
 * A 2x2 field divided by dashed hairlines: a heading cell and three
 * figures. Each cell puts its figure at the top and its caption at the
 * bottom, so the values sit on one line across the row and the captions
 * on another, whatever length either happens to be.
 *
 * The dashed rule is the one border this design language allows, first
 * introduced in the hero. Depth everywhere else comes from the tint
 * cycle, and the cycle cannot draw a line across open space - open space
 * divided by lines is the whole of this section.
 *
 * ## The rules are elements, not borders
 *
 * They are drawn on as the section arrives, and a border cannot be
 * transformed independently of the box it belongs to, so each one is a
 * positioned span. Each span hangs off the edge of *its own cell* rather
 * than being placed against the grid container: a cell's bottom edge is
 * its bottom edge in both the two-column and the one-column layout,
 * where a span placed at "half the container" is only correct in one of
 * them. Every cell carries a bottom rule and the container carries a
 * top one, which composes into the right set of lines at either
 * breakpoint without any of them knowing which layout they are in.
 *
 * ## Why not two independent columns
 *
 * That is what gives the reference its dividers at slightly different
 * heights per column. It also puts the cells in column order in the DOM
 * - heading, bottom-left, top-right, bottom-right - so a screen reader
 * gets a different order from the one on screen. The stagger reads as a
 * by-product of their content heights rather than as a device, and it is
 * not worth that.
 */
const RULE = "border-dashed border-foreground/20";

const CELL =
  "relative flex min-h-[17rem] flex-col justify-between py-10 sm:min-h-[20rem] sm:py-12";

/**
 * One line. `x` runs across and draws from the left; `y` runs down and
 * draws from the top. The start states and the directions live in
 * `landing.css` so they arrive with the HTML.
 */
function Rule({ axis, className }: { axis: "x" | "y"; className?: string }) {
  return (
    <span
      data-rule={axis}
      aria-hidden
      className={cn(
        "pointer-events-none absolute",
        axis === "x" ? "inset-x-0 border-t" : "inset-y-0 border-l",
        RULE,
        className
      )}
    />
  );
}

export function Impact() {
  const [first, second, third] = IMPACT.figures;

  return (
    <ImpactMotion className="pb-20 sm:pb-28">
      <div className="relative grid md:grid-cols-2">
        <Rule axis="x" className="top-0" />

        {/* Top left: the heading. Eyebrow at the top of the cell, the
            heading block sitting on the cell's floor with the figures. */}
        <div className={cn(CELL, "md:pr-12")}>
          <p
            data-reveal="eyebrow"
            className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
          >
            <span className="text-primary">({IMPACT.index})</span>
            {IMPACT.eyebrow}
          </p>

          <div className="mt-16 max-w-[28rem]">
            <h2
              data-reveal="figure"
              className="text-2xl font-medium tracking-[-0.02em] sm:text-3xl"
            >
              {IMPACT.heading}
            </h2>
            <p
              data-reveal="figure"
              className="mt-3 text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
            >
              {IMPACT.support}
            </p>
          </div>

          <Rule axis="x" className="bottom-0" />
          <Rule axis="y" className="right-0 max-md:hidden" />
        </div>

        <div className={cn(CELL, "md:pl-12")}>
          <FigureBody {...first} />
          <Rule axis="x" className="bottom-0" />
        </div>

        <div className={cn(CELL, "md:pr-12")}>
          <FigureBody {...second} />
          <Rule axis="x" className="bottom-0" />
          <Rule axis="y" className="right-0 max-md:hidden" />
        </div>

        <div className={cn(CELL, "md:pl-12")}>
          <FigureBody {...third} />
          <Rule axis="x" className="bottom-0" />
        </div>
      </div>
    </ImpactMotion>
  );
}

function FigureBody({ value, caption }: { value: string; caption: string }) {
  return (
    <>
      {/* Proportional figures, not tabular: a standalone value at this
          size reads loose when every digit is padded to the width of a
          zero. `tabular-nums` is for columns of numbers that must align. */}
      <p
        data-reveal="figure"
        className="text-[clamp(2.5rem,5vw,4.5rem)] leading-[0.95] font-medium tracking-[-0.045em] text-balance"
      >
        {value}
      </p>
      <p
        data-reveal="figure"
        className="mt-10 max-w-[22rem] text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
      >
        {caption}
      </p>
    </>
  );
}
