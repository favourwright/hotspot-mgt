import { cn } from "@/lib/utils";
import {
  Empty as BaseEmpty,
  EmptyContent as BaseEmptyContent,
  EmptyDescription as BaseEmptyDescription,
  EmptyHeader as BaseEmptyHeader,
  EmptyMedia as BaseEmptyMedia,
  EmptyTitle as BaseEmptyTitle,
} from "@/components/ui/empty";

/**
 * Tuned defaults over `ui/empty`.
 *
 * The stock sizes are drawn for a full-page empty state. Inside a card at
 * our density the parts stop reading as one object, so the whole block is
 * pulled in: tighter gaps, a smaller tile, and a title that sits *below*
 * the card's own 20px heading rather than competing with it.
 */
export function Empty({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmpty>) {
  return <BaseEmpty className={cn("py-6", className)} {...props} />;
}

export function EmptyHeader({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmptyHeader>) {
  return <BaseEmptyHeader className={cn("gap-1.5", className)} {...props} />;
}

export function EmptyMedia({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmptyMedia>) {
  return (
    <BaseEmptyMedia
      // `rounded-lg`, not the stock `rounded-full`: in this language a
      // circle reads as a control (an avatar, an icon button), and a
      // squircle reads as a container. This tile is a container.
      // `mb-1` buys it a little more room than the 6px text gap without
      // reopening the gap between title and description.
      className={cn("mb-1 size-10 rounded-lg [&_svg]:size-5", className)}
      {...props}
    />
  );
}

export function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmptyTitle>) {
  return (
    <BaseEmptyTitle className={cn("text-sm font-medium", className)} {...props} />
  );
}

export function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmptyDescription>) {
  return (
    <BaseEmptyDescription className={cn("text-xs", className)} {...props} />
  );
}

export function EmptyContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseEmptyContent>) {
  return <BaseEmptyContent className={cn("mt-3", className)} {...props} />;
}
