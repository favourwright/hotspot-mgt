import { cn } from "@/lib/utils";
import { CONTENT_WIDTHS } from "@/components/system/widths";

interface AppShellProps extends React.ComponentProps<"div"> {
  /**
   * Drops the width cap so the column runs the full viewport. For screens
   * that are genuinely edge-to-edge (a full-bleed table, a map); the default
   * is capped, because past ~1400px the grid stops reading as a composition.
   */
  fluid?: boolean;
  /**
   * Centres the column in the viewport instead of stacking from the top.
   * For the single-object screens -- sign in, the onboarding wizard, the
   * landing card -- which have no nav band to anchor them.
   */
  center?: boolean;
}

/**
 * The page canvas. Paints the tint full-bleed, caps and centres the content
 * column, sets the gutter, and spaces the bands (nav / title / toolbar /
 * grid) that pages drop into it.
 *
 * Deliberately has no radius, border, shadow or background of its own on the
 * inner column -- the tint belongs to the viewport, and surface is reserved
 * for cards. The tint is scoped here rather than set on `--background`,
 * which is load-bearing for dialogs, popovers and sheets.
 */
export function AppShell({
  className,
  fluid = false,
  center = false,
  children,
  ...props
}: AppShellProps) {
  return (
    <div
      className={cn(
        "min-h-dvh bg-canvas",
        center && "grid place-items-center"
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full flex-col gap-6",
          "px-4 pt-4 sm:px-6 sm:pt-6 lg:px-8",
          // Real breathing room under the last card -- a page that ends
          // flush at the fold reads as truncated.
          "pb-16",
          !fluid && !center && CONTENT_WIDTHS.default,
          center && cn(CONTENT_WIDTHS.narrow, "pb-4"),
          className
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}
