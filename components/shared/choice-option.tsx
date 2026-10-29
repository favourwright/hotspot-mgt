"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * One card in a pick-one-of-a-few choice.
 *
 * The onboarding plan picker's card (`components/onboarding/step-choose-plan.tsx`),
 * down to the tick badge and the `bg-foreground/85` selected fill, first
 * lifted out for "Who is this for?" in the checkout and now shared, so every
 * place that asks someone to choose between a few consequences looks like
 * the same control. Callers render a group of these, and decide whether
 * anything is preselected: usually nothing is, on purpose.
 */
export function ChoiceOption({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    // A real button with `aria-pressed`, not a bordered div: the selected
    // state is carried by the surface, exactly as in the onboarding plan
    // picker this is lifted from. The opacities are load-bearing there and
    // kept as-is - a hover below ~10% black reads as the surface rather
    // than as a hover, and the selected fill stays off full black so it
    // sits under the dialog's own action.
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 rounded-4xl p-4 text-left transition-colors",
        selected
          ? "bg-foreground/85 text-background"
          : "bg-foreground/3 hover:bg-foreground/5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full transition-colors",
            selected ? "bg-background text-foreground" : "bg-sunken text-transparent"
          )}
        >
          <Check className="size-3" />
        </span>
      </div>
      <span
        className={cn(
          "text-sm",
          selected ? "text-background/70" : "text-muted-foreground"
        )}
      >
        {detail}
      </span>
    </button>
  );
}
