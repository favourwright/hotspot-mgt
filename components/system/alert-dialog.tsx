import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent as BaseAlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter as BaseAlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia as BaseAlertDialogMedia,
  AlertDialogTitle as BaseAlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** Same treatment as `DialogContent`. */
export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogContent>) {
  return (
    <BaseAlertDialogContent
      className={cn("rounded-surface ring-0 dark:ring-0", className)}
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogTitle>) {
  return (
    <BaseAlertDialogTitle
      className={cn("text-xl tracking-tight", className)}
      {...props}
    />
  );
}

/** `bg-muted` is the sunken tint; a squircle tile, as everywhere else. */
export function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogMedia>) {
  return (
    <BaseAlertDialogMedia
      className={cn("size-12 rounded-lg bg-sunken", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof BaseAlertDialogFooter>) {
  return (
    <BaseAlertDialogFooter
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

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTrigger,
};
