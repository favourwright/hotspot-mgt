import { cn } from "@/lib/utils";
import type { Badge } from "@/lib/docs-view";

/**
 * The coloured method tag from the reference designs. Translucent fills, so
 * the same badge reads on the dark sidebar, the dark code panels and the
 * light page.
 */
const TONES: Record<Badge, string> = {
  GET: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  POST: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  PUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  PATCH: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
  EVENT: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  HOOK: "bg-primary/15 text-primary",
};

/** On a dark surface the lighter shade reads better in both themes. */
const ON_DARK: Record<Badge, string> = {
  GET: "bg-emerald-400/15 text-emerald-400",
  POST: "bg-sky-400/15 text-sky-400",
  PUT: "bg-amber-400/15 text-amber-400",
  PATCH: "bg-amber-400/15 text-amber-400",
  DELETE: "bg-red-400/15 text-red-400",
  EVENT: "bg-violet-400/15 text-violet-400",
  HOOK: "bg-pink-400/15 text-pink-400",
};

const SHORT: Record<Badge, string> = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DEL",
  EVENT: "EVT",
  HOOK: "HOOK",
};

export function MethodBadge({
  method,
  size = "md",
  onDark = false,
  className,
}: {
  method: Badge;
  size?: "sm" | "md";
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-mono font-semibold tracking-wide",
        size === "sm" ? "h-4 min-w-9 px-1.5 text-[0.6rem]" : "h-6 px-2.5 text-xs",
        onDark ? ON_DARK[method] : TONES[method],
        className
      )}
    >
      {size === "sm" ? SHORT[method] : method}
    </span>
  );
}
