import { cn } from "@/lib/utils";
import { PRICING } from "@/lib/landing-content";
import { getPublicBillingPlans } from "@/lib/billing-plans";
import { PlanCard } from "@/components/marketing/pricing/plan-card";
import { PricingMotion } from "@/components/marketing/pricing/pricing-motion";

/**
 * Section 5.
 *
 * The only section on this page that reads live data. The plans are the
 * same billing plans a tenant picks from during onboarding, so the price
 * advertised here cannot drift from the price they are actually charged.
 *
 * ## Why this renders at request time
 *
 * `app/(marketing)/page.tsx` sets `dynamic = "force-dynamic"` for this
 * section's sake, and the reason is worth stating because it looks like
 * a performance mistake otherwise. CI runs `npm run build` with no
 * Firebase credentials, so anything prerendered at build time that
 * touches Firestore fails the build. Rendering at request time keeps the
 * build credential-free, and `getPublicBillingPlans` caches the list in
 * process for five minutes, so the Firestore cost is one read per plan
 * per five minutes per instance rather than one per visitor - which
 * matters on the page with the most traffic and no login.
 *
 * ## Failure is silent on purpose, within limits
 *
 * If Firestore is unreachable the section renders nothing rather than
 * taking the whole landing page down with it. A marketing page missing
 * its price list is bad; a marketing page returning a 500 is worse. The
 * error is logged so it is not invisible to anyone looking.
 */
export async function Pricing() {
  let plans;
  try {
    plans = await getPublicBillingPlans();
  } catch (error) {
    console.error("Landing pricing: failed to load billing plans", error);
    return null;
  }

  if (plans.length === 0) return null;

  // The badge is what nominates a plan, so the page holds no opinion of
  // its own about which to push. First in sort order wins if more than
  // one is badged, which is a data problem rather than something to
  // resolve cleverly here.
  const featuredId = plans.find((plan) => plan.badge)?.id ?? null;

  /**
   * The reference's arrangement: one narrow card beside the wide
   * featured one, in a six-column grid. With four plans that pair takes
   * the first row and the remaining two split the second as equal
   * halves.
   *
   *   2 plans -> [2, 4]          exactly the reference
   *   4 plans -> [2, 4, 2, 2]    the pair, then two of the same width
   *
   * The second row keeps the narrow card's own width rather than
   * stretching to halves, so every non-featured plan is the same size
   * wherever it lands. Four columns of content in a six-column grid
   * leaves two spare, so the row is centred by starting it at column
   * two - `justify-center` would not do it, because the items are grid
   * children placed in tracks, not a flex line.
   *
   * Six columns rather than three because three cannot express a
   * centred pair underneath a 1:2 pair.
   *
   * Only the featured plan is ever wide. An earlier version made the
   * second row a mirrored pair, which produced a second split card whose
   * action sat in a white panel wearing the white `raised` tone and all
   * but disappeared. The split layout exists to give the promoted plan
   * room for a long description and a panelled action; a plan that is
   * not being promoted has no use for either.
   */
  const SPANS: Record<number, number[]> = {
    1: [6],
    2: [2, 4],
    3: [2, 2, 2],
    4: [2, 4, 2, 2],
  };
  const spans = SPANS[plans.length] ?? plans.map(() => 2);

  /**
   * Explicit column starts, for a row that does not fill the grid. Keyed
   * by plan count, then by the position that begins the short row; every
   * card after it flows on from there.
   */
  const STARTS: Record<number, Record<number, string>> = {
    4: { 2: "lg:col-start-2" },
  };
  const starts = STARTS[plans.length] ?? {};

  /**
   * The promoted plan belongs in the wide slot - it is the one carrying
   * the long description and the panelled action, and the narrow layout
   * has nowhere to put either. Sort order decides everything else, so
   * this is a single swap rather than a re-sort.
   */
  const ordered = [...plans];
  const wideSlot = spans.findIndex((span) => span >= 4);
  if (featuredId && wideSlot >= 0) {
    const featuredAt = ordered.findIndex((plan) => plan.id === featuredId);
    if (featuredAt >= 0 && featuredAt !== wideSlot) {
      [ordered[wideSlot], ordered[featuredAt]] = [
        ordered[featuredAt],
        ordered[wideSlot],
      ];
    }
  }

  // Literal class names, because Tailwind cannot see a string built at
  // runtime.
  const SPAN_CLASS: Record<number, string> = {
    2: "lg:col-span-2",
    3: "lg:col-span-3",
    4: "lg:col-span-4",
    6: "lg:col-span-6",
  };

  return (
    <PricingMotion className="pb-20 sm:pb-28">
      <div className="mx-auto max-w-[42rem] text-center">
        <p
          data-reveal="eyebrow"
          className="flex items-baseline justify-center gap-3 text-xs font-medium tracking-[0.12em] uppercase"
        >
          <span className="text-primary">({PRICING.index})</span>
          {PRICING.eyebrow}
        </p>

        <h2 className="mt-8 text-[clamp(2rem,3.6vw,3.25rem)] leading-[1.02] font-medium tracking-[-0.03em]">
          {PRICING.heading.map((line) => (
            <span key={line} data-reveal="heading" className="block">
              {line}
            </span>
          ))}
        </h2>

        <p
          data-reveal="support"
          className="mt-6 text-[0.95rem] leading-relaxed text-muted-foreground text-pretty"
        >
          {PRICING.support}
        </p>
      </div>

      {/* One column below `lg`: the split card's two-column interior has
          nowhere to go on a narrow screen, so every card falls back to
          the stacked design there. */}
      <div className="mt-14 grid gap-5 lg:grid-cols-6">
        {ordered.map((plan, position) => {
          const span = spans[position] ?? 2;
          return (
            <div
              key={plan.id}
              data-reveal="plan"
              className={cn(SPAN_CLASS[span], starts[position])}
            >
              <PlanCard
                plan={plan}
                featured={plan.id === featuredId}
                wide={span >= 4}
              />
            </div>
          );
        })}
      </div>
    </PricingMotion>
  );
}
