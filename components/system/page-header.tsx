import { cn } from "@/lib/utils";

interface PageHeaderProps extends Omit<React.ComponentProps<"div">, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * The page's single primary action -- the one black pill. Everything
   * else on a page is a chip, a quiet card action or a menu item.
   */
  action?: React.ReactNode;
}

/**
 * The title band. Sits bare on the canvas, never in a card: in this design
 * language chrome is weightless and only data gets a surface.
 */
export function PageHeader({
  className,
  title,
  description,
  action,
  children,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-4",
        className
      )}
      {...props}
    >
      <div className="flex-1 flex max-md:flex-col md:items-center gap-2 justify-between">
        <div className="min-w-0">
          {/* Deliberately oversized -- the hierarchy here has no middle
              register, so the title leads and everything else drops away. */}
          <h1 className="truncate text-3xl font-medium tracking-tight sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
