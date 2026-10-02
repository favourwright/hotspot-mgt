import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

interface ToolbarProps extends React.ComponentProps<"div"> {
  /** Pushed to the right -- search, overflow. Scope controls go in children. */
  end?: React.ReactNode;
}

/**
 * The scope band: filters and period on the left, search and overflow on
 * the right. Like the title band it sits bare on the canvas.
 */
export function Toolbar({ className, end, children, ...props }: ToolbarProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
      {end && <div className="ml-auto flex items-center gap-2">{end}</div>}
    </div>
  );
}

/**
 * The search pill. Strips `ui/input-group`'s tinted field and border for a
 * raised surface, since on the canvas it reads as a control sitting on the
 * page rather than a well sunk into it.
 */
export function SearchField({
  className,
  placeholder = "Search",
  ...props
}: React.ComponentProps<typeof InputGroupInput>) {
  return (
    <InputGroup
      className={cn(
        "h-11 w-full rounded-full border-transparent bg-raised sm:w-72",
        className
      )}
    >
      <InputGroupAddon>
        <Search className="text-muted-foreground" />
      </InputGroupAddon>
      <InputGroupInput placeholder={placeholder} {...props} />
    </InputGroup>
  );
}
