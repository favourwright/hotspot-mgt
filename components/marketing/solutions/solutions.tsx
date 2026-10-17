import { SOLUTIONS } from "@/lib/landing-content";
import { SolutionsAccordion } from "@/components/marketing/solutions/solutions-accordion";
import { SolutionsMotion } from "@/components/marketing/solutions/solutions-motion";

/**
 * Section 7.
 *
 * Shares the tinted band with section 6 rather than opening one of its
 * own: in the reference the two read as one stretch of ground, and a
 * second band with a seam between them would say they are separate
 * subjects when they are consecutive halves of the same pitch.
 *
 * The heading is indented to the same inner column section 2 uses, with
 * the eyebrow alone out to the left.
 */
export function Solutions() {
  return (
    <SolutionsMotion className="pb-16 sm:pb-20">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-16">
        <p
          data-reveal="eyebrow"
          className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({SOLUTIONS.index})</span>
          {SOLUTIONS.eyebrow}
        </p>

        <div className="max-w-[40rem]">
          <h2
            data-reveal="heading"
            className="text-[clamp(1.9rem,3.4vw,3rem)] leading-[1.04] font-medium tracking-[-0.03em]"
          >
            {SOLUTIONS.heading}
          </h2>
          <p
            data-reveal="support"
            className="mt-5 text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
          >
            {SOLUTIONS.support}
          </p>
        </div>
      </div>

      <div className="mt-14">
        <SolutionsAccordion />
      </div>
    </SolutionsMotion>
  );
}
