import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The content surface.
 *
 * Strips `ui/card`'s shadow and ring on purpose: depth in this design
 * language comes from the tint -> white -> tint cycle alone, and a card that
 * also casts a shadow and carries a hairline ring reads as three competing
 * depth cues at once.
 *
 * `tone` names where the card sits in that cycle. `inverted` is the
 * emphasis device -- the one filled card per screen -- and is the only
 * place the accent colour is allowed to carry a whole surface.
 */
export const surfaceCardVariants = cva(
  [
    "rounded-surface border-0 shadow-none ring-0",
    // The inset panel's fill, as a variable rather than a class, so each
    // tone can redefine it and a caller can override it without fighting
    // a descendant selector's specificity.
    "[--inset-bg:var(--surface-sunken)]",
  ],
  {
    variants: {
      tone: {
        raised: "bg-raised text-foreground",
        sunken: "bg-sunken text-foreground",
        inverted: [
          "bg-primary text-primary-foreground",
          // The muted tones inside would otherwise stay grey against the fill.
          "[&_[data-slot=card-description]]:text-primary-foreground/70",
          "[&_.text-muted-foreground]:text-primary-foreground/70",
          // Grey would read as a mistake on the fill -- darken the fill
          // itself instead. `rgba()` rather than a `/` alpha so Tailwind
          // doesn't read the slash as an opacity modifier.
          "[--inset-bg:rgba(0,0,0,0.1)]",
        ],
      },
    },
    defaultVariants: { tone: "raised" },
  }
);

type SurfaceCardProps = React.ComponentProps<typeof Card> &
  VariantProps<typeof surfaceCardVariants> & {
    /** `compact` (the default) matches the nav bar's 8px frame. */
    density?: keyof typeof CARD_DENSITY;
  };

/**
 * The card's gutter, which `ui/card` derives header padding, content padding
 * and the gap between them from. `compact` matches the nav bar's own `p-2`,
 * so every container in the system frames its contents by the same measure.
 */
const CARD_DENSITY = {
  compact: "0.5rem",
  default: "1rem",
} as const;

export function SurfaceCard({
  className,
  tone,
  density = "compact",
  style,
  ...props
}: SurfaceCardProps) {
  return (
    <Card
      // Set inline rather than as a class: `ui/card` declares
      // `--card-spacing` at the same specificity, so which one won would
      // come down to stylesheet order. Inline always wins, and spreading
      // `style` after leaves the door open for a caller to override.
      style={
        {
          "--card-spacing": CARD_DENSITY[density],
          ...style,
        } as React.CSSProperties
      }
      className={cn(surfaceCardVariants({ tone }), className)}
      {...props}
    />
  );
}

/**
 * The sunken block nested inside a card -- the third step of the cycle.
 * Not a card: it has no header grammar and never nests further.
 */
export function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-panel bg-sunken p-4", className)}
      {...props}
    />
  );
}

interface SurfaceCardContentProps extends React.ComponentProps<typeof CardContent> {
  /**
   * Sinks the content into a nested panel, leaving the header on the white
   * surface above it -- the tint -> white -> tint cycle, completed. On by
   * default: it's the house style, and a flat card is the exception.
   *
   * Pass `inset={false}` for content that shouldn't be boxed -- a list that
   * runs to the card's edges, or anything already sitting on its own panel.
   */
  inset?: boolean;
  /**
   * The panel's fill. Defaults to the tone's own `--inset-bg`; pass any
   * colour to override a single card, e.g.
   * `insetBackground="var(--color-chart-2)"`. For a Tailwind class instead,
   * a `bg-*` in `className` also wins -- both are plain classes, so the
   * merge keeps the last one.
   */
  insetBackground?: string;
}

export function SurfaceCardContent({
  className,
  inset = true,
  insetBackground,
  style,
  ...props
}: SurfaceCardContentProps) {
  return (
    <CardContent
      data-inset={inset}
      style={
        insetBackground
          ? ({ "--inset-bg": insetBackground, ...style } as React.CSSProperties)
          : style
      }
      className={cn(
        // `mx` rather than `px`: the panel inhabits the card's gutter instead
        // of adding to it, so the inset edge lines up with the header text.
        inset && "mx-(--card-spacing) rounded-panel bg-(--inset-bg) p-4",
        className
      )}
      {...props}
    />
  );
}

/**
 * Title left, one quiet action right -- the grammar is native to `ui/card`
 * via CardAction, so this only adjusts the measure.
 *
 * The extra horizontal inset sits the header between the inset panel's edge
 * (at the card's 8px gutter) and the panel's content (at 24px), which is
 * where the reference puts it: indented enough to read as a heading, not so
 * far that it detaches from the block beneath.
 */
export function SurfaceCardHeader({
  className,
  ...props
}: React.ComponentProps<typeof CardHeader>) {
  return <CardHeader className={cn("px-5", className)} {...props} />;
}

/** Larger than `ui/card`'s 16px default -- card titles are a real step in
 *  the hierarchy here, not a label. */
export function SurfaceCardTitle({
  className,
  ...props
}: React.ComponentProps<typeof CardTitle>) {
  return (
    <CardTitle
      className={cn("text-xl font-medium tracking-tight", className)}
      {...props}
    />
  );
}

export {
  CardAction as SurfaceCardAction,
  CardDescription as SurfaceCardDescription,
  CardFooter as SurfaceCardFooter,
};
