import { cn } from "@/lib/utils";
import { CONTENT_WIDTHS, type ContentWidth } from "@/components/system/widths";

interface PageContentProps extends React.ComponentProps<"main"> {
  /**
   * Narrows the content column without touching the nav above it. Defaults
   * to the shell's own measure, so nav and content align unless a page
   * deliberately asks otherwise.
   */
  width?: ContentWidth;
}

/**
 * The page's main region. Owns the vertical rhythm between the bands a page
 * stacks inside it (header / toolbar / grid) and, optionally, a narrower
 * measure than the shell.
 */
export function PageContent({
  className,
  width = "default",
  children,
  ...props
}: PageContentProps) {
  return (
    <main
      className={cn(
        // `flex-1` so the main region absorbs the shell's spare height
        // rather than leaving the canvas bare under a short page.
        "flex w-full flex-1 flex-col gap-6",
        // `default` is the shell's measure already -- re-applying it here
        // would be a no-op that merely risks drift.
        width !== "default" && cn("mx-auto", CONTENT_WIDTHS[width]),
        className
      )}
      {...props}
    >
      {children}
    </main>
  );
}
