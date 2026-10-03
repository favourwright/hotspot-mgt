import { cn } from "@/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"

interface ErrorStateProps extends React.ComponentProps<typeof Empty> {
  icon: React.ReactNode
  title: string
  description?: React.ReactNode
  /** A retry or recovery control, rendered under the description. */
  action?: React.ReactNode
}

/**
 * The empty state's sibling, for when content couldn't load rather than
 * simply isn't there.
 *
 * Same shape on purpose -- icon tile, title, description, optional action --
 * so a failure reads as a state of the thing the user was looking at, not as
 * a banner bolted above a blank region. Only the tile's tone differs, which
 * is the one signal that should separate "nothing here yet" from "something
 * went wrong".
 */
export function ErrorState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <Empty className={cn(className)} {...props}>
      <EmptyHeader>
        <EmptyMedia
          variant="icon"
          className="bg-destructive/10 text-destructive"
        >
          {icon}
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
