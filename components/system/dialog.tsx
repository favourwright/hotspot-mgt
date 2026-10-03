import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent as BaseDialogContent,
  DialogDescription,
  DialogFooter as BaseDialogFooter,
  DialogHeader,
  DialogPortal,
  DialogTitle as BaseDialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Dialogs on the system's terms.
 *
 * The ring comes off, as it has everywhere else -- a modal is already
 * separated from the page by its scrim, so a hairline is a third separator
 * doing nothing. The shadow stays: this is the one place in the app where
 * elevation is literal rather than decorative.
 */
export function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogContent>) {
  return (
    <BaseDialogContent
      className={cn("rounded-surface ring-0 dark:ring-0", className)}
      {...props}
    />
  );
}

/** Matches `SurfaceCardTitle` -- a dialog heading is a card heading. */
export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogTitle>) {
  return (
    <BaseDialogTitle
      className={cn("text-xl tracking-tight", className)}
      {...props}
    />
  );
}

/**
 * The same button pair the rest of the app uses: secondary first at its
 * natural width, primary filling the rest, stacking below `sm`. The stock
 * footer is `flex-col-reverse`, which puts the primary action on *top* on a
 * phone -- the opposite of every other form in this app.
 */
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialogFooter>) {
  return (
    <BaseDialogFooter
      className={cn(
        "flex flex-col gap-2 sm:flex-row",
        // Actions share the row evenly. Scoped to `sm` and up: `flex-1`
        // resolves against the main axis, so in the stacked layout it would
        // collapse each button's height instead of its width.
        "sm:[&>*]:flex-1",
        "[&>*:last-child]:max-sm:order-last",
        className
      )}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogDescription, DialogHeader, DialogPortal, DialogTrigger };
