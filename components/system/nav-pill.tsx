import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The navigation pill. Shares the active/inactive tones with every other
 * navigable surface in the system, so the top bar and the mobile sheet can
 * never drift apart.
 */
export const navPillVariants = cva(
  "flex items-center rounded-full text-sm font-medium transition-colors",
  {
    variants: {
      active: {
        true: "bg-foreground text-background",
        false: "text-muted-foreground hover:bg-sunken hover:text-foreground",
      },
      scale: {
        default: "px-5 py-2.5",
        block: "w-full gap-3 px-4 py-2.5",
      },
    },
    defaultVariants: { active: false, scale: "default" },
  }
);

type NavPillProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof navPillVariants>;

export function NavPill({ className, active, scale, ...props }: NavPillProps) {
  return (
    <Link
      className={cn(navPillVariants({ active, scale }), className)}
      {...props}
    />
  );
}
