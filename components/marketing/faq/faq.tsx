import Link from "next/link";
import { ArrowRight, Minus, Plus } from "lucide-react";

import { FAQ } from "@/lib/landing-content";
import { FAQ_CATEGORIES, faqSummary } from "@/lib/faq-data";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/system/accordion";
import { FaqMotion } from "@/components/marketing/faq/faq-motion";

/**
 * Section 9.
 *
 * The questions come from `lib/faq-data.ts` - the same entries `/faq`
 * renders - picked by id and summarised to one paragraph. The landing
 * page and the FAQ page answer the same questions for the same people
 * minutes apart, so a second copy of the wording here would be a second
 * thing to keep true.
 *
 * Built on the shared `Accordion` rather than a bespoke disclosure. The
 * valuable part of that primitive is the behaviour - the ARIA wiring,
 * the keyboard handling, one panel open at a time - and none of that is
 * worth rewriting for a different icon. The presentational overrides
 * bring it to the reference: its arrow icons are hidden in favour of
 * the plus/minus pair, the dashed row rule it deliberately omits is
 * added back, and the card-context rounding and hover tint are
 * cancelled, because here the rows sit on open page rather than inside
 * a card that already separates them. Horizontal padding is already
 * zero in the shared wrapper, so none is overridden here.
 */
export function Faq() {
  const entries = FAQ.picks
    .map((id) =>
      FAQ_CATEGORIES.flatMap((category) => category.entries).find(
        (entry) => entry.id === id
      )
    )
    // A pick that no longer resolves means an id was renamed in the FAQ
    // data. Dropping it keeps the page standing; the alternative is a
    // marketing page that 500s because a support answer was retitled.
    .filter((entry) => entry !== undefined);

  if (entries.length === 0) return null;

  return (
    <FaqMotion className="pb-20 sm:pb-28">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:gap-16">
        <p
          data-reveal="eyebrow"
          className="flex items-baseline gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({FAQ.index})</span>
          {FAQ.eyebrow}
        </p>

        <div className="min-w-0">
          <h2 className="max-w-[20ch] text-[clamp(1.9rem,3.4vw,3rem)] leading-[1.04] font-medium tracking-[-0.03em]">
            {FAQ.heading.map((line) => (
              <span key={line} data-reveal="heading" className="block">
                {line}
              </span>
            ))}
          </h2>

          <p
            data-reveal="support"
            className="mt-5 max-w-[34rem] text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
          >
            {FAQ.support}
          </p>

          {/* First one open, as the reference has it: an accordion that
              starts fully closed hides the fact that there are answers
              behind it at all. */}
          <Accordion className="mt-12" defaultValue={[entries[0].id]}>
            {entries.map((entry) => (
              <AccordionItem
                key={entry.id}
                value={entry.id}
                data-reveal="row"
                className="border-t border-dashed border-foreground/20 last:border-b"
              >
                <AccordionTrigger
                  className={[
                    "group/faq items-center py-6 text-base font-medium sm:text-lg",
                    "rounded-none hover:bg-transparent",
                    // The primitive's own arrows, out of the way.
                    "**:data-[slot=accordion-trigger-icon]:hidden",
                  ].join(" ")}
                >
                  <span className="pr-6 text-left">{entry.question}</span>
                  <span
                    aria-hidden
                    className="ml-auto grid size-6 shrink-0 place-items-center text-muted-foreground"
                  >
                    <Plus className="size-5 group-aria-expanded/faq:hidden" />
                    <Minus className="hidden size-5 group-aria-expanded/faq:block" />
                  </span>
                </AccordionTrigger>

                <AccordionContent className="pb-6">
                  <p className="max-w-[48rem] text-[0.95rem] leading-relaxed text-muted-foreground text-pretty">
                    {faqSummary([...entry.answer])}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <Link
            href={FAQ.link.href}
            className="group mt-10 inline-flex items-center gap-3 text-xs font-medium tracking-[0.08em] text-primary uppercase underline underline-offset-[6px] transition-colors hover:text-foreground"
          >
            {FAQ.link.label}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </div>
    </FaqMotion>
  );
}
