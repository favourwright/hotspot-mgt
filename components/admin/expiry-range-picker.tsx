"use client"

import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"
import { type DateRange } from "react-day-picker"

import { Button } from "@/components/system/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface ExpiryRangePickerProps {
  /** ISO day strings (yyyy-MM-dd), or "" for unset. */
  from: string
  to: string
  onChange: (from: string, to: string) => void
}

/**
 * Dates are passed in and out as plain `yyyy-MM-dd` strings rather than
 * Date objects: they live in the URL query so the filter survives a reload,
 * and a day string is unambiguous there in a way a serialised Date is not.
 */
function toDate(value: string): Date | undefined {
  if (!value) return undefined
  // Explicit local midnight -- `new Date("2026-10-04")` parses as UTC and
  // can land on the previous day west of Greenwich.
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

function toDayString(date: Date | undefined): string {
  return date ? format(date, "yyyy-MM-dd") : ""
}

export function ExpiryRangePicker({
  from,
  to,
  onChange,
}: ExpiryRangePickerProps) {
  const selected: DateRange | undefined = from || to
    ? { from: toDate(from), to: toDate(to) }
    : undefined

  const hasRange = Boolean(from || to)

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Popover>
        <PopoverTrigger
          render={
            <Button
              tone="raised"
              scale="sm"
              className="justify-start px-2.5 font-normal"
              aria-label="Filter by expiry date"
            />
          }
        >
          <CalendarIcon data-icon="inline-start" />
          {selected?.from ? (
            selected.to ? (
              <>
                {format(selected.from, "LLL dd, y")} -{" "}
                {format(selected.to, "LLL dd, y")}
              </>
            ) : (
              format(selected.from, "LLL dd, y")
            )
          ) : (
            <span>Expiry date</span>
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            defaultMonth={selected?.from}
            selected={selected}
            onSelect={(range) =>
              onChange(toDayString(range?.from), toDayString(range?.to))
            }
            numberOfMonths={2}
            className="hidden sm:block"
          />
          {/* One month on phones: two side by side overflow the viewport. */}
          <Calendar
            mode="range"
            defaultMonth={selected?.from}
            selected={selected}
            onSelect={(range) =>
              onChange(toDayString(range?.from), toDayString(range?.to))
            }
            numberOfMonths={1}
            className="sm:hidden"
          />
        </PopoverContent>
      </Popover>

      {hasRange && (
        <Button
          tone="raised"
          scale="sm"
          onClick={() => onChange("", "")}
          aria-label="Clear date range"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
