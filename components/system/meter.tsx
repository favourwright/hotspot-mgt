import { TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

interface MeterProps {
  label: string
  /** Consumed amount, in the same unit as `total`. */
  used: number
  /** The allowance. null or 0 means unlimited - then there is no ratio to draw. */
  total: number | null
  /** Renders a raw number as text, e.g. bytes -> "4.2 GB". */
  format: (value: number) => string
  /** Fraction at which the fill switches to the danger step. */
  criticalAt?: number
  className?: string
}

/**
 * A single ratio against a limit.
 *
 * Deliberately a meter and not a chart: one value against one limit is the
 * case a two-slice pie is always the wrong answer to. The track is the fill
 * hue at low alpha - a lighter step of the same ramp - so the bar reads as
 * one object in both themes rather than a coloured bar sitting in a grey
 * slot.
 *
 * Severity is carried by the fill, but never by colour alone: past the
 * critical threshold an icon and the words appear beside it, so the state
 * survives colourblindness, greyscale printing and forced-colors mode.
 */
export function Meter({
  label,
  used,
  total,
  format,
  criticalAt = 0.9,
  className,
}: MeterProps) {
  const unlimited = !total || total <= 0
  const ratio = unlimited ? 0 : Math.min(used / total, 1)
  const critical = !unlimited && ratio >= criticalAt
  const percent = Math.round(ratio * 100)

  // The fill and its track come from one hue so state reads across the whole
  // bar; only the hue changes at the threshold.
  const hue = critical ? "var(--destructive)" : "var(--chart-4)"

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm">
          {format(used)}
          {!unlimited && (
            <span className="text-muted-foreground"> of {format(total)}</span>
          )}
          {unlimited && <span className="text-muted-foreground"> used</span>}
        </span>
      </div>

      {unlimited ? (
        <p className="text-xs text-muted-foreground">No limit set</p>
      ) : (
        <>
          <div
            // 8px track: thin marks. The fill keeps a square baseline edge
            // and a 4px rounded data-end.
            className="h-2 w-full overflow-hidden rounded-[4px]"
            style={{
              background: `color-mix(in oklch, ${hue} 16%, transparent)`,
            }}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label}: ${percent}% used`}
          >
            <div
              className="h-full rounded-r-[4px]"
              style={{
                background: hue,
                // A non-zero amount should never render as nothing.
                width: ratio > 0 ? `max(${ratio * 100}%, 2px)` : 0,
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {percent}% used
            </span>
            {critical && (
              <span className="inline-flex items-center gap-1 text-xs text-destructive">
                <TriangleAlert className="size-3 shrink-0" />
                Almost used up
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
