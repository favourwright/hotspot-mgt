import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardHeader,
  SurfaceCardTitle,
  type CardActionSpec,
} from "@/components/system/surface-card";

/**
 * Splits a leading currency symbol off a formatted value so it can be
 * de-emphasised -- the number is the hero, the unit is context.
 * `\p{Sc}` is the Unicode currency category, so this covers ₦ from
 * `formatNaira` as well as $, € and £ without hardcoding any of them.
 */
function splitCurrency(value: string | number) {
  if (typeof value !== "string") return { symbol: null, rest: String(value) };
  const match = value.match(/^(\p{Sc})\s*(.+)$/u);
  return match
    ? { symbol: match[1], rest: match[2] }
    : { symbol: null, rest: value };
}

export interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  description?: string;
  /** The one filled card on a screen. Emphasis, not severity. */
  inverted?: boolean;
  /**
   * Adds the quiet affordance top-right; with an `href` or `onClick` the
   * whole tile becomes the click target.
   */
  action?: CardActionSpec | React.ReactNode;
  className?: string;
}

/**
 * A single metric. Shared by every dashboard so the measure, title size and
 * number scale can't drift between them.
 */
export function StatCard({
  title,
  value,
  icon: Icon,
  description,
  inverted,
  action,
  className,
}: StatCardProps) {
  const { symbol, rest } = splitCurrency(value);
  // One muted tone for every secondary mark on the card -- icon, currency
  // unit and description -- so they read as the same layer.
  const muted = inverted ? "text-primary-foreground/70" : "text-muted-foreground";

  return (
    <SurfaceCard
      tone={inverted ? "inverted" : "raised"}
      action={action}
      className={className}
    >
      <SurfaceCardHeader>
        {/* The icon lives inside the title rather than beside it: the card
            header is a grid that only opens a second column for a
            `card-action`, so a bare sibling would wrap onto its own row. */}
        <SurfaceCardTitle
          className={cn(
            "flex items-center gap-2",
            inverted && "text-primary-foreground"
          )}
        >
          <Icon className={cn("size-4 shrink-0", muted)} />
          {title}
        </SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent>
        {/* The number is the hero -- everything around it stays small. */}
        <div className="text-4xl font-semibold tracking-tight tabular-nums">
          {symbol && <span className={muted}>{symbol}</span>}
          {rest}
        </div>
        {description && (
          <p className={cn("mt-1 text-xs", muted)}>{description}</p>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  );
}
