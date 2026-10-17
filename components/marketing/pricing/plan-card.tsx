import Link from "next/link";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { PRICING } from "@/lib/landing-content";
import { formatPlanFee, planBullets } from "@/lib/billing-plan-display";
import { Button } from "@/components/system/button";
import { Amount } from "@/components/system/amount";
import type { BillingPlan } from "@/types/schemas";

/**
 * One plan, in one of the reference's two card designs.
 *
 * These are genuinely different layouts, not one layout with a darker
 * fill, and an earlier version got that wrong by giving both an inset
 * panel and putting the action outside it:
 *
 * - **Stacked** (the narrow card). One column. The inclusions sit
 *   directly on the card's tint with no panel around them, and the
 *   action is full width on the card's floor.
 * - **Split** (the wide card). Two columns: the name, description and
 *   price on the left, and an inset panel on the right holding the
 *   inclusions AND the action. The panel IS the right-hand column, not
 *   a box inside a stack.
 *
 * `wide` and `featured` are independent on purpose. `wide` is a layout
 * decision the grid makes from how many plans there are; `featured` is
 * emphasis, and comes from the plan's own `badge` - a field that exists
 * for exactly this ("Most popular") and is set by a superadmin, so the
 * page needs no opinion of its own about which plan to push. A wide card
 * is not necessarily the black one, and no badge anywhere means no black
 * card, which is correct rather than a fallback.
 */
export function PlanCard({
  plan,
  featured,
  wide,
}: {
  plan: BillingPlan;
  featured: boolean;
  wide: boolean;
}) {
  const bullets = planBullets(plan);
  const interval = plan.billingInterval === "yearly" ? "year" : "month";
  const isCustom = plan.billingModel === "custom";
  const isFree = plan.billingModel === "free";
  /**
   * A plan with no monthly fee that takes a cut of each sale: the cut is
   * the price, so it leads. Rendering it the generic way produced
   * "N0 /month" with the real number demoted to a footnote underneath,
   * which reads as free with a catch rather than as pay-as-you-earn.
   */
  const usagePriced =
    !isFree && !isCustom && plan.monthlyFee === 0 && plan.platformFeePercent > 0;

  const muted = featured ? "text-background/65" : "text-muted-foreground";

  const heading = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl font-medium tracking-tight">{plan.name}</h3>
        {plan.badge && (
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium",
              featured
                ? "bg-primary text-primary-foreground"
                : "bg-raised text-muted-foreground"
            )}
          >
            {plan.badge}
          </span>
        )}
      </div>
      {plan.description && (
        <p className={cn("text-[0.95rem] leading-relaxed text-pretty", muted)}>
          {plan.description}
        </p>
      )}
    </div>
  );

  const price = (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-1">
        {isFree ? (
          <span className="text-[2.75rem] leading-none font-medium tracking-tight">
            Free
          </span>
        ) : isCustom ? (
          <span className="text-[2.75rem] leading-none font-medium tracking-tight">
            Let&rsquo;s talk
          </span>
        ) : usagePriced ? (
          <>
            <span className="text-[2.75rem] leading-none font-medium tracking-tight text-primary">
              {plan.platformFeePercent}%
            </span>
            <span className="text-base font-medium">of each sale</span>
          </>
        ) : (
          <>
            {/* The accent on the figure with a small currency symbol
                beside it, which is how the reference sets a price, and the
                one place a number carries the brand colour. */}
            <Amount
              value={formatPlanFee(plan.monthlyFee)}
              className="text-[2.75rem] leading-none font-medium tracking-tight text-primary"
              symbolClassName={cn("text-lg", muted)}
            />
            <span className="text-base font-medium">/{interval}</span>
          </>
        )}
      </p>
      {plan.platformFeePercent > 0 && !usagePriced && (
        <p className={cn("text-sm", muted)}>
          Plus {plan.platformFeePercent}% of each sale
        </p>
      )}
    </div>
  );

  const included = bullets.length > 0 && (
    <div className="flex flex-col gap-4">
      <p
        className={cn(
          "text-[0.7rem] font-medium tracking-[0.12em] uppercase",
          muted
        )}
      >
        {PRICING.includedLabel}:
      </p>
      <ul className="flex flex-col gap-3">
        {bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-3 text-sm">
            {/* A filled disc with a check, matching the reference and the
                marker the hero already uses, rather than an outline icon
                that would read as a different vocabulary. */}
            <span
              className={cn(
                "mt-px grid size-[1.1rem] shrink-0 place-items-center rounded-full",
                featured
                  ? "bg-background/20 text-background/80"
                  : "bg-foreground/15 text-foreground/70"
              )}
            >
              <Check className="size-2.5" strokeWidth={3} />
            </span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  const action = isCustom ? (
    <Button
      tone={featured ? "accent" : "raised"}
      nativeButton={false}
      className="h-12 w-full"
      render={
        plan.contactUrl ? (
          <a href={plan.contactUrl} target="_blank" rel="noopener noreferrer" />
        ) : (
          // Plain `/onboarding`, with no `?plan=` hint. The wizard does not
          // read search params, so a plan id in the URL would suggest a
          // preselection that never happens.
          <Link href={PRICING.ctaHref} />
        )
      }
    >
      {PRICING.contactLabel}
    </Button>
  ) : (
    <Button
      tone={featured ? "accent" : "raised"}
      nativeButton={false}
      className="h-12 w-full"
      render={<Link href={PRICING.ctaHref} />}
    >
      {PRICING.ctaLabel}
    </Button>
  );

  const surface = cn(
    "flex h-full rounded-surface p-7 sm:p-9",
    featured ? "bg-foreground text-background" : "bg-sunken"
  );

  if (!wide) {
    return (
      <article className={cn(surface, "flex-col gap-7")}>
        {heading}
        {included}
        <div className="mt-auto flex flex-col gap-5 pt-2">
          {price}
          {action}
        </div>
      </article>
    );
  }

  return (
    <article className={cn(surface, "flex-col gap-8 lg:flex-row lg:gap-10")}>
      <div className="flex flex-1 flex-col gap-10">
        {heading}
        <div className="mt-auto">{price}</div>
      </div>

      <div
        className={cn(
          "flex flex-col gap-6 rounded-panel p-6 lg:w-[21rem] lg:shrink-0",
          featured ? "bg-background/10" : "bg-raised"
        )}
      >
        {included}
        <div className="mt-auto">{action}</div>
      </div>
    </article>
  );
}
