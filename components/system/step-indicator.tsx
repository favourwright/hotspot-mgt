"use client";

import { cn } from "@/lib/utils";

interface StepIndicatorProps extends React.ComponentProps<"div"> {
  /** 1-based. */
  current: number;
  total: number;
  /**
   * Makes completed steps clickable. Omit for flows where a step can't be
   * revisited -- the bars then render as plain, non-interactive marks
   * rather than buttons that do nothing.
   */
  onStepClick?: (step: number) => void;
}

/**
 * Progress through a multi-step flow, as a row of bars.
 *
 * Filled bars use `bg-foreground` and pending ones `bg-sunken`: the same
 * "you are here" black as the nav pill, and the system's own tint for the
 * track rather than `bg-muted`, which is invisible on a sunken panel.
 */
export function StepIndicator({
  current,
  total,
  onStepClick,
  className,
  ...props
}: StepIndicatorProps) {
  return (
    <div
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
      aria-label={`Step ${current} of ${total}`}
      className={cn("flex gap-2", className)}
      {...props}
    >
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => {
        const filled = step <= current;
        const clickable = Boolean(onStepClick) && step < current;

        return clickable ? (
          <button
            key={step}
            type="button"
            aria-label={`Back to step ${step}`}
            onClick={() => onStepClick?.(step)}
            className={cn(
              "h-2 flex-1 cursor-pointer rounded-full transition-colors hover:opacity-80",
              filled ? "bg-foreground" : "bg-sunken"
            )}
          />
        ) : (
          <span
            key={step}
            className={cn(
              "h-2 flex-1 rounded-full transition-colors",
              filled ? "bg-foreground" : "bg-sunken"
            )}
          />
        );
      })}
    </div>
  );
}
