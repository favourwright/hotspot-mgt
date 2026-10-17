import { Link2, Router, Tags } from "lucide-react";

import { HOW } from "@/lib/landing-content";
import { HowMotion } from "@/components/marketing/how/how-motion";
import { PortalMock } from "@/components/marketing/how/portal-mock";

/**
 * Section 6.
 *
 * The one band on this page with a surface of its own. Everything else
 * sits directly on the page's white and brings a tint only at card
 * scale; this section is tinted end to end, which is what the reference
 * does and what keeps a page of open white from running on too long
 * without a change of ground.
 *
 * The step icons are keyed by the step's own `key` rather than held in
 * the content file. An icon is a component, and putting components in
 * `landing-content.ts` would make a file of plain strings into one that
 * cannot be edited without touching React.
 */
const STEP_ICONS = {
  connect: Router,
  price: Tags,
  sell: Link2,
} as const;

export function How() {
  return (
    <HowMotion className="rounded-surface bg-sunken px-6 py-16 sm:px-10 sm:py-20 lg:px-14">
      <p
        data-reveal="eyebrow"
        className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
      >
        <span className="text-primary">({HOW.index})</span>
        {HOW.eyebrow}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end lg:gap-16">
        <h2 className="text-[clamp(1.9rem,3.4vw,3rem)] leading-[1.04] font-medium tracking-[-0.03em]">
          {HOW.heading.map((line) => (
            <span key={line} data-reveal="heading" className="block">
              {line}
            </span>
          ))}
        </h2>

        <p
          data-reveal="support"
          className="text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
        >
          {HOW.support}
        </p>
      </div>

      <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <ol className="flex flex-col gap-10">
          {HOW.steps.map((step, position) => {
            const Icon = STEP_ICONS[step.key];
            return (
              <li
                key={step.key}
                data-reveal="step"
                className="flex items-start gap-5"
              >
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="flex items-baseline gap-3 text-lg font-medium tracking-tight">
                    {/* The step's number, quiet beside its name. The list
                        is an `ol`, so the order is already in the markup;
                        this is the visible form of it. */}
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {String(position + 1).padStart(2, "0")}
                    </span>
                    {step.title}
                  </h3>
                  <p className="mt-2 max-w-[28rem] text-[0.95rem] leading-relaxed text-muted-foreground text-pretty">
                    {step.copy}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div data-reveal="mock">
          <PortalMock />
        </div>
      </div>
    </HowMotion>
  );
}
