import { cn } from "@/lib/utils";
import {
  Tabs,
  TabsContent,
  TabsList as BaseTabsList,
  TabsTrigger as BaseTabsTrigger,
} from "@/components/ui/tabs";

/**
 * The tab track.
 *
 * `ui/tabs` defaults to `bg-muted`, which is all but identical to
 * `--surface-sunken` -- so inside a card's inset panel, where tabs usually
 * live, the track disappears and only the active pill is visible. Raising
 * it to white restores the tint -> white contrast the rest of the system
 * relies on.
 */
export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsList>) {
  return (
    <BaseTabsList
      // Full width on phones so the triggers' own `flex-1` has room to
      // divide -- `ui/tabs` ships `w-fit`, which shrinks the track to its
      // labels and leaves two cramped tabs against the screen edge. Back to
      // content width from `sm` up, where a stretched track looks adrift.
      className={cn("w-full bg-raised sm:w-fit", className)}
      {...props}
    />
  );
}

/**
 * Active state is the sunken tint on the white track -- the same
 * tint-against-white delta the rest of the system uses for depth, just
 * inverted. Deliberately not the near-black `action` tone: that belongs to
 * the page's one primary action and the nav's current location, and a third
 * black anchor on the same screen would flatten the hierarchy.
 */
export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof BaseTabsTrigger>) {
  return (
    <BaseTabsTrigger
      className={cn(
        "text-muted-foreground hover:text-foreground",
        "data-active:bg-sunken data-active:text-foreground",
        "dark:data-active:bg-sunken dark:data-active:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export { Tabs, TabsContent };
