import { WHY } from "@/lib/landing-content";
import { WhyMotion } from "@/components/marketing/why/why-motion";
import { WhyTabs } from "@/components/marketing/why/why-tabs";

/**
 * Section 2.
 *
 * The layout is a two-column split with a deliberately empty left column:
 * the eyebrow sits alone out there and everything else starts at the same
 * inner edge. That indent is what gives the reference its composed feel,
 * and it collapses to a single stacked column below `lg` rather than
 * squeezing a label into a sliver.
 */
export function Why() {
  return (
    <WhyMotion className="py-20 sm:py-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-16">
        <p
          data-reveal="eyebrow"
          className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({WHY.index})</span>
          {WHY.eyebrow}
        </p>

        <div className="max-w-[46rem]">
          <h2 className="text-[clamp(2rem,3.6vw,3.25rem)] leading-[1.02] font-medium tracking-[-0.03em]">
            {/* Two lines, each revealed on its own, which is why they are
                separate elements rather than a `<br>`. */}
            {WHY.heading.map((line) => (
              <span key={line} data-reveal="heading" className="block">
                {line}
              </span>
            ))}
          </h2>

          <p
            data-reveal="support"
            className="mt-6 max-w-[34rem] text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
          >
            {WHY.support}
          </p>

          <div data-reveal="panel" className="mt-12">
            <WhyTabs />
          </div>
        </div>
      </div>
    </WhyMotion>
  );
}
