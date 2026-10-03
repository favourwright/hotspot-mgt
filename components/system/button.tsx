import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Button as BaseButton } from "@/components/ui/button";

/**
 * Presets over `ui/button`. Tones are named for the surface the button sits
 * ON, not for its own colour -- the same control is white on the canvas and
 * sunken on a card, and getting that backwards is the easiest way to break
 * the tint -> white -> tint depth cycle.
 *
 * Note `action` is the near-black `foreground`, never `primary`: in this
 * design language tone carries "press me", and the accent colour is reserved
 * for data. There should be exactly one `action` per page.
 */
export const systemButtonVariants = cva("rounded-full border-transparent", {
  variants: {
    // Every tone states its own hover background AND hover text. The base
    // `ghost` variant we pass down carries `hover:bg-muted hover:text-foreground`,
    // and anything a tone leaves unset survives the merge -- which is how
    // `action` ended up with near-black text on its near-black fill.
    tone: {
      action:
        "bg-foreground text-background hover:bg-foreground/90 hover:text-background dark:hover:bg-foreground/90",
      // The one place the accent is allowed on a control. `action` assumes
      // a single primary per page; a storefront has one per plan card, and
      // a grid of near-black pills reads as a wall rather than a choice.
      accent:
        "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90",
      raised:
        "bg-raised text-foreground hover:bg-sunken hover:text-foreground dark:hover:bg-sunken",
      sunken:
        "bg-sunken text-muted-foreground hover:bg-sunken hover:text-foreground dark:hover:bg-sunken",
      ghost:
        "bg-transparent text-muted-foreground hover:bg-sunken hover:text-foreground dark:hover:bg-sunken",
      // For a control that sits in a form row beside `ui/input` -- a
      // dropdown standing in for a select. Matches the input's fill and
      // radius so the row doesn't look like two different kinds of thing.
      field:
        "rounded-3xl bg-input/50 text-foreground hover:bg-input/70 hover:text-foreground dark:hover:bg-input/70",
    },
    scale: {
      default: "h-11 gap-2 px-5 text-sm",
      sm: "h-9 gap-1.5 px-4 text-sm",
      icon: "size-11 gap-0 px-0",
      "icon-sm": "size-9 gap-0 px-0",
    },
  },
  defaultVariants: { tone: "raised", scale: "default" },
});

type SystemButtonProps = React.ComponentProps<typeof BaseButton> &
  VariantProps<typeof systemButtonVariants>;

export function Button({
  className,
  tone,
  scale,
  ...props
}: SystemButtonProps) {
  return (
    <BaseButton
      // Neutralise the base `default` variant's `bg-primary` so our tone is
      // the only thing painting a background.
      variant="ghost"
      className={cn(systemButtonVariants({ tone, scale }), className)}
      {...props}
    />
  );
}
