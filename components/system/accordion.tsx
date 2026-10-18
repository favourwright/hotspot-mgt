import { cn } from "@/lib/utils";
import {
  Accordion as BaseAccordion,
  AccordionContent as BaseAccordionContent,
  AccordionItem as BaseAccordionItem,
  AccordionTrigger as BaseAccordionTrigger,
} from "@/components/ui/accordion";

/**
 * `ui/accordion` ships as a self-contained bordered box. Here it always
 * lives inside a `SurfaceCard`, which already provides the container, so
 * the border and radius come off and the rows separate with a hairline
 * instead.
 *
 * Rows carry no horizontal padding of their own: the question and the
 * answer both start on the container's edge, so the answer lines up with
 * the question text. The container (card or page) supplies any inset.
 */
export function Accordion({
  className,
  ...props
}: React.ComponentProps<typeof BaseAccordion>) {
  return (
    <BaseAccordion
      className={cn("rounded-none border-0", className)}
      {...props}
    />
  );
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof BaseAccordionItem>) {
  return (
    <BaseAccordionItem
      // No row divider: the trigger's hover tint and the expanded panel do
      // the separating, and a hairline between rows is the one border this
      // system doesn't draw.
      //
      // The stock open state tints with `bg-muted/50`, which is invisible
      // against a sunken panel -- the open row is already marked by its
      // expanded content and flipped chevron.
      // `not-last:border-b-0`, not plain `border-0`: the base class is
      // `not-last:border-b`, whose `:not(:last-child)` selector outranks an
      // unmodified class. Matching the modifier lets the merge drop it.
      //
      // The last selector zeroes the primitive's outer panel padding, which
      // `AccordionContent`'s className never reaches (it lands on the inner
      // node).
      className={cn(
        "not-last:border-b-0 data-open:bg-transparent",
        "[&_[data-slot=accordion-content]]:px-0",
        className
      )}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  ...props
}: React.ComponentProps<typeof BaseAccordionTrigger>) {
  return (
    <BaseAccordionTrigger
      // No underline on hover: questions are headings, not links. The row
      // tints instead, which matches how every other list behaves here.
      className={cn(
        "gap-6 px-0 py-4 text-base font-medium hover:no-underline",
        "rounded-panel transition-colors hover:bg-sunken",
        className
      )}
      {...props}
    />
  );
}

export function AccordionContent({
  className,
  ...props
}: React.ComponentProps<typeof BaseAccordionContent>) {
  return <BaseAccordionContent className={cn("px-0", className)} {...props} />;
}
