import * as React from "react";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
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
    // The action chip's foreground. Paired with `--inset-bg` so the chip
    // always sits legibly on whatever surface its card is.
    "[--chip-fg:var(--muted-foreground)]",
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
          // Without this the chip inherits the grey `--chip-fg` and lands
          // light-on-light against the darkened fill.
          "[--chip-fg:var(--primary-foreground)]",
        ],
      },
    },
    defaultVariants: { tone: "raised" },
  }
);

/**
 * A card's single quiet affordance, shown top-right of the header -- the
 * reference's "View details >" / "Add card". Given a `href` or `onClick`,
 * the whole card becomes the click target and this renders as the visible
 * cue for it.
 */
export interface CardActionSpec {
  label: string;
  href?: string;
  onClick?: () => void;
  /** Defaults to a chevron; `null` drops it. */
  icon?: LucideIcon | null;
  /**
   * Whether the action covers the whole card. Default `true`, which is
   * right for a card that is nothing but a label and a number -- the
   * target is then as big as the card.
   *
   * `false` keeps the click on the chip alone. The stretched overlay is
   * the card's last child and nothing beneath it is raised, so it takes
   * every click on the card: a table row cannot be opened, an email
   * address cannot be selected to copy, and a nested button is dead. Any
   * card with real content under the header wants `false`.
   */
  stretch?: boolean;
}

type SurfaceCardProps = React.ComponentProps<typeof Card> &
  VariantProps<typeof surfaceCardVariants> & {
    /** `compact` (the default) matches the nav bar's 8px frame. */
    density?: keyof typeof CARD_DENSITY;
    /**
     * Either a spec -- which by default also makes the whole card
     * pressable, see `CardActionSpec.stretch` -- or an arbitrary node for a
     * slot that manages its own behaviour.
     *
     * Injected into the direct `SurfaceCardHeader` child, so it lands in
     * `ui/card`'s native action column rather than being positioned over
     * the title. A card with no header child renders no action.
     */
    action?: CardActionSpec | React.ReactNode;
  };

function isActionSpec(value: unknown): value is CardActionSpec {
  return (
    typeof value === "object" &&
    value !== null &&
    !React.isValidElement(value) &&
    "label" in value
  );
}

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
  action,
  children,
  ...props
}: SurfaceCardProps) {
  const spec = isActionSpec(action) ? action : null;
  const interactive = Boolean(spec?.href || spec?.onClick);
  // Whole-card press is the default. `stretch: false` keeps the click on the
  // chip, which is the only way content under the header stays usable.
  const stretched = interactive && (spec?.stretch ?? true);
  const Icon = spec?.icon === undefined ? ChevronRight : spec.icon;

  // `buttonVariants`, not `<Button>`: the chip has to look like a button in
  // both arrangements, and in the stretched one it must not *be* one.
  const chipClassName = cn(
    buttonVariants({ variant: "ghost", size: "sm" }),
    "rounded-full bg-(--inset-bg) text-(--chip-fg) transition-colors",
    stretched
      ? // Cancel the ghost variant's own fill so the card-level hover is the
        // only thing that paints the chip -- the pointer is never on the
        // chip alone, it is on the card.
        "hover:bg-(--inset-bg) hover:text-(--chip-fg) group-hover/press:bg-foreground group-hover/press:text-background"
      : interactive
        ? // The chip is the control now, so it paints on its own hover --
          // the same fill the stretched card gives it, just driven from here.
          "hover:bg-foreground hover:text-background"
        : // Decorative: a spec with neither `href` nor `onClick`. Cancel the
          // hover so it doesn't offer something it cannot do.
          "hover:bg-(--inset-bg) hover:text-(--chip-fg)"
  );

  const chipContent = spec && (
    <>
      {spec.label}
      {Icon && <Icon className="size-3.5" />}
    </>
  );

  let rendered: React.ReactNode;
  if (!spec) {
    // Narrowed by `isActionSpec` above -- anything that isn't a spec is a
    // plain node the caller wants rendered as-is.
    rendered = action as React.ReactNode;
  } else if (interactive && !stretched) {
    // The real control, and the only one: no overlay is rendered below, so
    // this is the card's single tab stop rather than a second one.
    rendered = spec.href ? (
      <Link href={spec.href} className={chipClassName}>
        {chipContent}
      </Link>
    ) : (
      <button type="button" onClick={spec.onClick} className={chipClassName}>
        {chipContent}
      </button>
    );
  } else {
    // Either the visible cue for the stretched overlay below, or a purely
    // decorative chip. Not a control in either case.
    rendered = <span className={chipClassName}>{chipContent}</span>;
  }

  // Hand the action to the header child. Context would be the tidier
  // mechanism, but `createContext` is client-only and these cards render
  // inside server components.
  const childrenWithAction = rendered
    ? React.Children.map(children, (child) =>
        React.isValidElement(child) && child.type === SurfaceCardHeader
          ? React.cloneElement(
              child as React.ReactElement<{ action?: React.ReactNode }>,
              { action: rendered }
            )
          : child
      )
    : children;

  return (
    <>
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
        className={cn(
          surfaceCardVariants({ tone }),
          stretched && "group/press relative cursor-pointer",
          className
        )}
        {...props}
      >
        {childrenWithAction}
        {stretched &&
          (spec?.href ? (
            <Link
              href={spec.href}
              // One stretched, labelled control covering the card. Anything
              // inside that needs its own click target takes `relative z-10`.
              className="absolute inset-0 rounded-surface focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <span className="sr-only">{spec.label}</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={spec?.onClick}
              className="absolute inset-0 rounded-surface focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
            >
              <span className="sr-only">{spec?.label}</span>
            </button>
          ))}
      </Card>
    </>
  );
}

/**
 * The block nested inside a card -- the third step of the cycle. Not a
 * card: it has no header grammar and never nests further.
 *
 * `tone` exists because the default assumes the panel sits on a white
 * card. Anything inside a `SurfaceCardContent` is already on the sunken
 * surface, so a `sunken` panel there is invisible against its own parent --
 * those want `raised`.
 */
export function Panel({
  className,
  tone = "sunken",
  ...props
}: React.ComponentProps<"div"> & { tone?: "sunken" | "raised" }) {
  return (
    <div
      className={cn(
        "rounded-panel p-4",
        tone === "raised" ? "bg-raised" : "bg-sunken",
        className
      )}
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
  children,
  action,
  ...props
}: React.ComponentProps<typeof CardHeader> & {
  /** Normally supplied by `SurfaceCard`'s `action` prop, not set by hand. */
  action?: React.ReactNode;
}) {
  return (
    <CardHeader className={cn("px-5", action && "items-center", className)} {...props}>
      {children}
      {action && (
        // `CardAction`'s base spans two grid rows, which is right when a
        // description is present and wrong when it isn't -- the second row
        // is then empty, and `self-center` centres the action against the
        // doubled height, sitting it below the title. Span one row by
        // default and restore the two-row span only when the header
        // actually has a description to span.
        <CardAction className="row-span-1 self-center group-has-data-[slot=card-description]/card-header:row-span-2">
          {action}
        </CardAction>
      )}
    </CardHeader>
  );
}

/** Larger than `ui/card`'s 16px default -- card titles are a real step in
 *  the hierarchy here, not a label. */
export function SurfaceCardTitle({
  className,
  ...props
}: React.ComponentProps<typeof CardTitle>) {
  return (
    <CardTitle
      className={cn("md:text-xl font-medium tracking-tight", className)}
      {...props}
    />
  );
}

/**
 * The row under a card's content.
 *
 * Two shapes, because the two things that live down there want opposite
 * measures:
 *
 * - `actions` (the default) keeps `ui/card`'s own gutter padding, which is
 *   what a single full-width button wants - the storefront and portal plan
 *   cards both put their Buy button here.
 * - `toolbar` lines up with `SurfaceCardHeader` instead, so a pagination row
 *   or a count sits directly under the title rather than out at the card's
 *   edge, and takes a top gutter to separate it from the inset panel above.
 *
 * No hairline in either. Depth in this system comes from the tint cycle, and
 * the inset panel's own edge already does the separating - a border here
 * would be the third depth cue the card deliberately does without.
 */
export function SurfaceCardFooter({
  className,
  variant = "actions",
  ...props
}: React.ComponentProps<typeof CardFooter> & {
  variant?: "actions" | "toolbar";
}) {
  return (
    <CardFooter
      className={cn(
        variant === "toolbar" &&
          "justify-between gap-3 px-5 pt-(--card-spacing)",
        className
      )}
      {...props}
    />
  );
}

export {
  CardAction as SurfaceCardAction,
  CardDescription as SurfaceCardDescription,
};
