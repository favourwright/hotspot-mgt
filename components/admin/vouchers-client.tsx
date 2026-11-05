"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Voucher } from "@/types/schemas"
import { formatDate } from "@/lib/utils"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { StatCard } from "@/components/system/stat-card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import { Button as SystemButton } from "@/components/system/button"
import { PageHeader } from "@/components/system/page-header"
import { ExpiryRangePicker } from "@/components/admin/expiry-range-picker"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/system/empty-state"
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Copy,
  Search,
  TicketIcon,
  Wifi,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { copyTextToClipboard } from "@/lib/clipboard"
import { apiClient } from "@/lib/api-client"

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
  // A sale like any other, and counted as one everywhere money is counted -
  // it just is not the live row for its login any more, because the
  // customer renewed onto a newer voucher sharing the same code.
  { value: "superseded", label: "Renewed" },
] as const

const STATUS_VARIANT: Record<
  Voucher["status"],
  "default" | "secondary" | "destructive"
> = {
  active: "default",
  failed: "destructive",
  expired: "secondary",
  superseded: "secondary",
}

const STATUS_LABEL: Record<Voucher["status"], string> = {
  active: "Active",
  failed: "Failed",
  expired: "Expired",
  superseded: "Renewed",
}

interface Totals {
  count: number
  activeCount: number
  todayCount: number
}

interface VouchersClientProps {
  initialVouchers: Voucher[]
  initialCursor: string | null
  initialTotals: Totals
  pageSize: number
}

export function VouchersClient({
  initialVouchers,
  initialCursor,
  initialTotals,
  pageSize,
}: VouchersClientProps) {
  const searchParams = useSearchParams()

  // Filters live in the URL so a reload or a shared link lands on the same
  // view - same arrangement as the transactions page.
  const [lookupTerm, setLookupTerm] = useState(
    () => searchParams.get("q") ?? ""
  )
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") ?? "all"
  )
  const [soldFrom, setSoldFrom] = useState(() => searchParams.get("from") ?? "")
  const [soldTo, setSoldTo] = useState(() => searchParams.get("to") ?? "")

  const [vouchers, setVouchers] = useState(initialVouchers)
  const [totals, setTotals] = useState<Totals | null>(initialTotals)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  // Separate from `loading`: turning a page does not recount the totals, so
  // blanking the cards on every click would be numbers flickering for no
  // reason.
  const [totalsLoading, setTotalsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLookup, setIsLookup] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // The server already rendered page one unfiltered. Without this, the
  // first effect run would immediately refetch exactly that.
  const primed = useRef(true)

  // Native history.replaceState rather than router.replace: the latter is a
  // navigation, so every keystroke would re-run this route's server
  // component for a change the client already rendered.
  useEffect(() => {
    const params = new URLSearchParams()
    if (lookupTerm) params.set("q", lookupTerm)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (soldFrom) params.set("from", soldFrom)
    if (soldTo) params.set("to", soldTo)

    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    )
  }, [lookupTerm, statusFilter, soldFrom, soldTo])

  const load = useCallback(
    async (cursor: string | null, lookup: string) => {
      setLoading(true)
      setTotalsLoading(!cursor)
      setError(null)
      try {
        const response = await apiClient.get("/api/admin/vouchers", {
          params: {
            status: statusFilter === "all" ? undefined : statusFilter,
            from: soldFrom || undefined,
            to: soldTo || undefined,
            cursor: cursor || undefined,
            lookup: lookup || undefined,
          },
        })
        const data = response.data
        setVouchers(data.vouchers)
        setNextCursor(data.nextCursor)
        setIsLookup(Boolean(data.isLookup))
        // Null on a page turn: the totals did not change, so the server
        // does not recount them.
        if (data.totals) setTotals(data.totals)
      } catch {
        setError("Couldn't load vouchers. Try again.")
      } finally {
        setLoading(false)
        setTotalsLoading(false)
      }
    },
    [statusFilter, soldFrom, soldTo]
  )

  // Any filter change starts the list over: a cursor is a position in one
  // specific ordered query, and carrying it into a different one points at
  // a row that may not be in the results at all.
  useEffect(() => {
    if (primed.current) {
      primed.current = false
      return
    }
    setCursors([null])
    setPageIndex(0)
    load(null, lookupTerm)
  }, [statusFilter, soldFrom, soldTo, lookupTerm, load])

  const goNext = () => {
    if (!nextCursor) return
    setCursors((prev) => [...prev.slice(0, pageIndex + 1), nextCursor])
    setPageIndex((i) => i + 1)
    load(nextCursor, "")
  }

  const goPrevious = () => {
    if (pageIndex === 0) return
    const target = cursors[pageIndex - 1] ?? null
    setPageIndex((i) => i - 1)
    load(target, "")
  }

  const copyToClipboard = async (text: string, field: string) => {
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    }
  }

  const hasFilters =
    statusFilter !== "all" || Boolean(soldFrom) || Boolean(soldTo)

  // Numbering is derived rather than stored: with a cursor there is no
  // total page count to count towards, only where this page starts.
  const firstRow = useMemo(
    () => (vouchers.length === 0 ? 0 : pageIndex * pageSize + 1),
    [vouchers.length, pageIndex, pageSize]
  )
  const lastRow = firstRow === 0 ? 0 : firstRow + vouchers.length - 1

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vouchers"
        description="Complete voucher history"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Exact username or email"
                value={lookupTerm}
                onChange={(e) => setLookupTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <ExpiryRangePicker
              from={soldFrom}
              to={soldTo}
              onChange={(from, to) => {
                setSoldFrom(from)
                setSoldTo(to)
              }}
              label="Sold"
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SystemButton tone="raised" scale="sm" />}
                className="w-40 shrink-0 justify-between"
              >
                {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ??
                  "All status"}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value || "all")}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Counted by Firestore over the same filter the table uses, rather
          than from the rows on screen - with one page loaded, the rows are
          not the whole answer. */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Vouchers"
          value={statValue(totals?.count.toLocaleString(), totalsLoading)}
          icon={TicketIcon}
          description={hasFilters ? "Matching the current filter" : "All time"}
        />
        <StatCard
          title="Active"
          value={statValue(totals?.activeCount.toLocaleString(), totalsLoading)}
          icon={Wifi}
          description={
            hasFilters ? "Still running, in this filter" : "Still running"
          }
        />
        <StatCard
          title="Today"
          value={statValue(totals?.todayCount.toLocaleString(), totalsLoading)}
          icon={CalendarDays}
          description="Sold today"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>
            {isLookup ? "Lookup results" : "Vouchers"}
          </SurfaceCardTitle>
          <SurfaceCardDescription>
            {isLookup
              ? "Matched on an exact username or email address."
              : "Newest first."}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        {/* `inset={false}`: a table runs to the card's edges - the sunken
            panel is for blocks, not rows. */}
        <SurfaceCardContent inset={false}>
          {loading ? (
            <TableSkeleton rows={Math.max(vouchers.length, 5)} />
          ) : vouchers.length === 0 ? (
            isLookup || hasFilters ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {isLookup
                  ? "Nothing matches that username or email. It has to match exactly."
                  : "No vouchers match this filter."}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <TicketIcon />
                  </EmptyMedia>
                  <EmptyTitle>No vouchers yet</EmptyTitle>
                  <EmptyDescription>
                    Vouchers appear here once customers start buying them.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : (
            <VouchersTable
              vouchers={vouchers}
              copiedField={copiedField}
              onCopy={copyToClipboard}
            />
          )}
        </SurfaceCardContent>

        {/* Hidden during a lookup: those results are not a page of anything,
            so paging through them would be meaningless. */}
        {!isLookup && vouchers.length > 0 && (
          <SurfaceCardFooter variant="toolbar">
            <span className="text-sm text-muted-foreground">
              {firstRow}-{lastRow}
              {totals && !hasFilters ? ` of ${totals.count}` : ""}
            </span>
            <div className="flex items-center gap-1 rounded-full bg-sunken p-1">
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={goPrevious}
                disabled={pageIndex === 0 || loading}
                aria-label="Previous page"
              >
                <ChevronLeft />
                <span className="max-sm:sr-only">Previous</span>
              </SystemButton>
              <SystemButton
                tone="raised"
                scale="sm"
                onClick={goNext}
                disabled={!nextCursor || loading}
                aria-label="Next page"
              >
                <span className="max-sm:sr-only">Next</span>
                <ChevronRight />
              </SystemButton>
            </div>
          </SurfaceCardFooter>
        )}
      </SurfaceCard>
    </div>
  )
}

function VouchersTable({
  vouchers,
  copiedField,
  onCopy,
}: {
  vouchers: Voucher[]
  copiedField: string | null
  onCopy: (text: string, field: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Location</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Password</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {vouchers.map((voucher) => (
          <TableRow key={voucher.id}>
            {/* The shared formatter, which pins Africa/Lagos. This table
                used to carry its own toLocaleString, so the same voucher
                read an hour earlier here than on the dashboard beside it. */}
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(voucher.createdAt)}
            </TableCell>
            <TableCell className="text-sm">
              {/* A generated code has no buyer on file: it was printed and
                  sold offline, and this row is its first use. */}
              {voucher.userEmail ?? (
                <Badge variant="outline">Generated code</Badge>
              )}
            </TableCell>
            <TableCell>{voucher.locationName}</TableCell>
            <TableCell>{voucher.planName}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <code className="text-xs">{voucher.username}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onCopy(voucher.username, `username-${voucher.id}`)
                  }
                >
                  {copiedField === `username-${voucher.id}` ? (
                    <CircleCheck className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <code className="text-xs">{voucher.password}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onCopy(voucher.password, `password-${voucher.id}`)
                  }
                >
                  {copiedField === `password-${voucher.id}` ? (
                    <CircleCheck className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            </TableCell>
            <TableCell>{voucher.duration}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[voucher.status]}>
                {STATUS_LABEL[voucher.status]}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * A stat's value, or a placeholder while the number behind it is being
 * refetched. A stale figure under a filter that has already changed is a
 * wrong number presented as a right one.
 */
function statValue(value: string | undefined, loading: boolean): string {
  if (loading) return "..."
  return value ?? "-"
}

/**
 * Rows, not a spinner. The table keeps its shape while a page loads, so the
 * footer and the cards above it do not jump.
 */
function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2 p-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
