"use client";

import {
  AlertCircle,
  Check,
  Infinity as InfinityIcon,
  Loader2,
  MapPin,
  Router,
  Users,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Amount } from "@/components/system/amount";
import { cn, formatNaira } from "@/lib/utils";
import { type OnboardingPlan } from "@/components/onboarding/types";


/**
 * Plan fees are always whole naira, and the ".00" `formatNaira` appends is
 * what pushes a four-figure price past the edge of a third-width card.
 */
function formatPlanFee(kobo: number) {
  return formatNaira(kobo).replace(/\.00$/, "");
}

/**
 * The booleans on `plan.features` as human bullets, appended to the plan's
 * own `featureList`. Only the enabled ones appear: an unchecked box is the
 * absence of a selling point, not a line that says "no API access".
 */
const FEATURE_LABELS: {
  key: keyof OnboardingPlan["features"];
  label: string;
}[] = [
  { key: "customBranding", label: "Custom branding" },
  { key: "apiAccess", label: "API access" },
  { key: "prioritySupport", label: "Priority support" },
];

/**
 * A plan's caps, icon-led so the label only has to carry the number -- the
 * same treatment as the superadmin plans table, deliberately, so a plan
 * reads the same to the person buying it and the person who priced it.
 *
 * `null` means no cap, which is a selling point rather than a missing
 * value, so it renders as an explicit glyph instead of being hidden.
 */
function PlanLimits({
  limits,
  selected,
}: {
  limits: OnboardingPlan["limits"];
  selected: boolean;
}) {
  const rows = [
    { icon: MapPin, value: limits.maxLocations, noun: "locations" },
    { icon: Router, value: limits.maxRouters, noun: "routers" },
    { icon: Users, value: limits.maxCustomers, noun: "customers" },
  ];

  return (
    <ul
      className={cn(
        "space-y-1.5 text-sm",
        selected ? "text-background/80" : "text-muted-foreground"
      )}
    >
      {rows.map(({ icon: Icon, value, noun }) => (
        <li key={noun} className="flex items-center gap-2">
          <Icon className="size-4 shrink-0" />
          {value === null ? (
            <span className="inline-flex items-center gap-1">
              <InfinityIcon className="size-4 shrink-0" aria-label="Unlimited" />
              {noun}
            </span>
          ) : (
            <span>
              {value.toLocaleString()} {noun}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Step2ChoosePlan({
  state,
  updateField,
  plans,
  plansLoading,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
  plans: OnboardingPlan[];
  plansLoading: boolean;
}) {
  if (plansLoading) {
    return (
      <div className="py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <span className="ml-2">No billing plans are available right now. Please contact support.</span>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Choose Your Billing Plan</h3>
        <p className="text-sm text-muted-foreground">
          You can change this later from your dashboard
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {plans.map((plan) => {
          const isCustom = plan.billingModel === "custom";
          const selected = !isCustom && state.planId === plan.id;
          const interval = plan.billingInterval === "yearly" ? "yr" : "mo";
          // The plan's own marketing bullets, plus whichever boolean
          // features are switched on. Both describe what you get; splitting
          // them into two lists on the card would be a distinction only the
          // schema cares about.
          const bullets = [
            ...plan.featureList,
            ...FEATURE_LABELS.filter(({ key }) => plan.features?.[key]).map(
              ({ label }) => label
            ),
          ];

          // A custom/"contact us" plan is never self-serve selectable - it
          // has no price to charge, so it can't enter the normal
          // pay-then-create-tenant flow at all (see step-confirm.tsx and
          // the server-side guard in create-tenant/route.ts). It still
          // shows every other real detail (description, limits, features),
          // just as a non-interactive card with its own Contact Us action
          // instead of a selection affordance.
          const cardBody = (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="truncate font-medium">{plan.name}</h4>
                  {/* Rendered even when empty so the price below starts at
                      the same height on every card in the row. */}
                  <span
                    className={cn(
                      "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium",
                      !plan.badge && "invisible",
                      selected
                        ? "bg-background/15 text-background"
                        : "bg-sunken text-muted-foreground"
                    )}
                  >
                    {plan.badge || "placeholder"}
                  </span>
                </div>
                {!isCustom && (
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full transition-colors",
                      selected
                        ? "bg-background text-foreground"
                        : "bg-sunken text-transparent"
                    )}
                  >
                    <Check className="size-3" />
                  </span>
                )}
              </div>

              <div>
                {plan.billingModel === "free" ? (
                  <span className="text-2xl font-semibold tracking-tight">
                    Free
                  </span>
                ) : isCustom ? (
                  <span className="text-2xl font-semibold tracking-tight">
                    Contact us
                  </span>
                ) : (
                  <span className="flex flex-wrap items-baseline gap-x-1">
                    <Amount
                      value={formatPlanFee(plan.monthlyFee)}
                      className="text-2xl font-semibold tracking-tight"
                      symbolClassName={
                        selected ? "text-background/60" : undefined
                      }
                    />
                    <span
                      className={cn(
                        "text-sm",
                        selected
                          ? "text-background/60"
                          : "text-muted-foreground"
                      )}
                    >
                      /{interval}
                    </span>
                  </span>
                )}
                {/* Reserved too, for the same reason as the badge. */}
                <p
                  className={cn(
                    "text-sm",
                    plan.platformFeePercent > 0 ? "" : "invisible",
                    selected ? "text-background/60" : "text-muted-foreground"
                  )}
                >
                  {plan.platformFeePercent || 0}% per transaction
                </p>
              </div>

              <p
                className={cn(
                  "text-sm",
                  selected ? "text-background/70" : "text-muted-foreground"
                )}
              >
                {plan.description}
              </p>

              {/* Limits first, then what the plan adds. Caps are the part a
                  tenant is most likely to be disqualified by, so they go
                  above the marketing bullets rather than below them. */}
              <div className="mt-auto space-y-3">
                <PlanLimits limits={plan.limits} selected={selected} />

                {bullets.length > 0 && (
                  <ul className="space-y-1.5 text-sm">
                    {bullets.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <Check
                          className={cn(
                            "mt-0.5 size-4 shrink-0",
                            selected
                              ? "text-background/70"
                              : "text-muted-foreground"
                          )}
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {isCustom &&
                (plan.contactUrl ? (
                  <a
                    href={plan.contactUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center justify-center rounded-surface bg-foreground px-3 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/85"
                  >
                    Contact Us
                  </a>
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">
                    Contact us for pricing
                  </p>
                ))}
            </>
          );

          if (isCustom) {
            return (
              <div
                key={plan.id}
                className="flex flex-col gap-3 rounded-surface bg-raised p-4 text-left"
              >
                {cardBody}
              </div>
            );
          }

          return (
            // A real button with `aria-pressed`, not a bordered div: the
            // selected state is carried by the surface.
            //
            // The opacities are load-bearing. These cards are white on the
            // wizard's sunken panel, so a hover below ~10% black reads as
            // the panel rather than as a hover; and the selected fill is
            // held off full black so it sits under the page's own actions.
            <button
              key={plan.id}
              type="button"
              aria-pressed={selected}
              onClick={() => updateField("planId", plan.id)}
              className={cn(
                "flex flex-col gap-3 rounded-surface p-4 text-left transition-colors",
                selected
                  ? "bg-foreground/85 text-background"
                  : "bg-raised hover:bg-foreground/5"
              )}
            >
              {cardBody}
            </button>
          );
        })}
      </div>
    </div>
  );
}
