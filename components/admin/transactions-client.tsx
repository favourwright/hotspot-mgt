"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Payment } from "@/types/schemas"
import { formatDate, formatNaira } from "@/lib/utils"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { StatCard } from "@/components/system/stat-card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/system/button"
import { PageHeader } from "@/components/system/page-header"
import { ExpiryRangePicker } from "@/components/admin/expiry-range-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import {
  AlertCircle,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  Receipt,
  Search,
} from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { apiClient } from "@/lib/api-client"

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "success", label: "Successful" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
] as const

const STATUS_VARIANT: Record<
  Payment["status"],
  "default" | "secondary" | "destructive"
> = {
  success: "default",
  pending: "secondary",
  failed: "destructive",
}

const STATUS_LABEL: Record<Payment["status"], string> = {
  success: "Successful",
  pending: "Pending",
  failed: "Failed",
}

interface Totals {
  count: number
  collectedKobo: number
  todayCount: number
  todayCollectedKobo: number
}

interface TransactionsClientProps {
  initialPayments: Payment[]
  initialCursor: string | null
  initialTotals: Totals
  pageSize: number
}

export function TransactionsClient({
  initialPayments,
  initialCursor,
  initialTotals,
  pageSize,
}: TransactionsClientProps) {
  const searchParams = useSearchParams()

  // Filters live in the URL so a reload or a shared link lands on the same
  // view -- same arrangement as the users page.
  const [lookupTerm, setLookupTerm] = useState(
    () => searchParams.get("q") ?? ""
  )
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") ?? "all"
  )
  const [paidFrom, setPaidFrom] = useState(() => searchParams.get("from") ?? "")
  const [paidTo, setPaidTo] = useState(() => searchParams.get("to") ?? "")

  const [payments, setPayments] = useState(initialPayments)
  const [totals, setTotals] = useState<Totals | null>(initialTotals)
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const [pageIndex, setPageIndex] = useState(0)
  const [nextCursor, setNextCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  // Separate from `loading`: turning a page does not recount the totals, so
  // blanking the cards on every click would be three numbers flickering for
  // no reason.
  const [totalsLoading, setTotalsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLookup, setIsLookup] = useState(false)

  // The server already rendered page one unfiltered. Without this, the
  // first effect run would immediately refetch exactly that.
  const primed = useRef(true)

  // Native history.replaceState rather than router.replace: the latter is a
  // navigation, so every keystroke would re-run this route's server
  // component for a change the client already rendered. Next integrates
  // these calls with useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams()
    if (lookupTerm) params.set("q", lookupTerm)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (paidFrom) params.set("from", paidFrom)
    if (paidTo) params.set("to", paidTo)

    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    )
  }, [lookupTerm, statusFilter, paidFrom, paidTo])

  const load = useCallback(
    async (cursor: string | null, lookup: string) => {
      setLoading(true)
      setTotalsLoading(!cursor)
      setError(null)
      try {
        const response = await apiClient.get("/api/admin/transactions", {
          params: {
            status: statusFilter === "all" ? undefined : statusFilter,
            from: paidFrom || undefined,
            to: paidTo || undefined,
            cursor: cursor || undefined,
            lookup: lookup || undefined,
          },
        })
        const data = response.data
        setPayments(data.payments)
        setNextCursor(data.nextCursor)
        setIsLookup(Boolean(data.isLookup))
        // Null on a page turn: the totals did not change, so the server
        // does not recount them.
        if (data.totals) setTotals(data.totals)
      } catch {
        setError("Couldn't load transactions. Try again.")
      } finally {
        setLoading(false)
        setTotalsLoading(false)
      }
    },
    [statusFilter, paidFrom, paidTo]
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
  }, [statusFilter, paidFrom, paidTo, lookupTerm, load])

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

  const hasFilters =
    statusFilter !== "all" || Boolean(paidFrom) || Boolean(paidTo)

  // Numbering is derived rather than stored: with a cursor there is no
  // total page count to count towards, only where this page starts.
  const firstRow = useMemo(
    () => (payments.length === 0 ? 0 : pageIndex * pageSize + 1),
    [payments.length, pageIndex, pageSize]
  )
  const lastRow = firstRow === 0 ? 0 : firstRow + payments.length - 1

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description="Complete payment history"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Exact reference or email"
                value={lookupTerm}
                onChange={(e) => setLookupTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <ExpiryRangePicker
              from={paidFrom}
              to={paidTo}
              onChange={(from, to) => {
                setPaidFrom(from)
                setPaidTo(to)
              }}
              label="Payment date"
            />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button tone="raised" scale="sm" />}
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
          than summed from the rows on screen -- with one page loaded, the
          rows are not the whole answer. */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          title="Transactions"
          value={statValue(totals?.count.toLocaleString(), totalsLoading)}
          icon={Receipt}
          description={
            hasFilters ? "Matching the current filter" : "All time"
          }
        />
        <StatCard
          title="Collected"
          value={statValue(
            totals ? formatNaira(totals.collectedKobo) : undefined,
            totalsLoading
          )}
          icon={Coins}
          description={
            hasFilters
              ? "Successful charges in this filter"
              : "Successful charges, all time"
          }
        />
        <StatCard
          title="Today"
          value={statValue(
            totals ? formatNaira(totals.todayCollectedKobo) : undefined,
            totalsLoading
          )}
          icon={CalendarDays}
          description={
            totals
              ? `${totals.todayCount} successful ${totals.todayCount === 1 ? "payment" : "payments"} today`
              : "Today's successful charges"
          }
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
            {isLookup ? "Lookup results" : "Transactions"}
          </SurfaceCardTitle>
          <SurfaceCardDescription>
            {isLookup
              ? "Matched on an exact reference or email address."
              : "Newest first."}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        {/* `inset={false}`: a table runs to the card's edges -- the sunken
            panel is for blocks, not rows. */}
        <SurfaceCardContent inset={false}>
          {loading ? (
            <TableSkeleton rows={Math.max(payments.length, 5)} />
          ) : payments.length === 0 ? (
            isLookup || hasFilters ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {isLookup
                  ? "Nothing matches that reference or email. It has to match exactly."
                  : "No transactions match this filter."}
              </div>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Receipt />
                  </EmptyMedia>
                  <EmptyTitle>No payments yet</EmptyTitle>
                  <EmptyDescription>
                    Payments appear here once customers start buying vouchers.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )
          ) : (
            <TransactionsTable payments={payments} />
          )}
        </SurfaceCardContent>

        {/* Hidden during a lookup: those results are not a page of anything,
            so paging through them would be meaningless. */}
        {!isLookup && payments.length > 0 && (
          <SurfaceCardFooter variant="toolbar">
            <span className="text-sm text-muted-foreground">
              {firstRow}-{lastRow}
              {totals && !hasFilters ? ` of ${totals.count}` : ""}
            </span>
            {/* One sunken track with two raised pills on it, rather than
                two buttons floating side by side: the pair is a single
                control, and the tint-white-tint cycle is how this system
                already says so. Same two buttons, grouped. */}
            <div className="flex items-center gap-1 rounded-full bg-sunken p-1">
              <Button
                tone="raised"
                scale="sm"
                onClick={goPrevious}
                disabled={pageIndex === 0 || loading}
                aria-label="Previous page"
              >
                <ChevronLeft />
                <span className="max-sm:sr-only">Previous</span>
              </Button>
              <Button
                tone="raised"
                scale="sm"
                onClick={goNext}
                disabled={!nextCursor || loading}
                aria-label="Next page"
              >
                <span className="max-sm:sr-only">Next</span>
                <ChevronRight />
              </Button>
            </div>
          </SurfaceCardFooter>
        )}
      </SurfaceCard>
    </div>
  )
}

function TransactionsTable({ payments }: { payments: Payment[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Your share</TableHead>
          <TableHead>Platform share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell className="text-muted-foreground">
              {formatDate(payment.createdAt)}
            </TableCell>
            <TableCell className="font-medium">{payment.userEmail}</TableCell>
            <TableCell>{payment.planName}</TableCell>
            {/* Constrained and truncating: a Paystack reference is long
                enough that letting it size the column pushes the table
                into its horizontal scroller and squeezes every other
                column. The full value stays available on hover. */}
            <TableCell className="text-muted-foreground">
              {/* The truncation lives on an inner block, not the cell: a
                  `max-width` on a `td` is ignored under the auto table
                  layout this table uses. */}
              <span
                className="block max-w-[10rem] truncate font-mono text-xs"
                title={payment.paystackReference}
              >
                {payment.paystackReference}
              </span>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[payment.status]}>
                {STATUS_LABEL[payment.status]}
              </Badge>
            </TableCell>
            <TableCell>{formatNaira(payment.amount)}</TableCell>
            {/* No subaccount means the charge was never split, so the whole
                amount is the tenant's. A named subaccount with no reported
                split is genuinely unknown, which is what "N/A" says. */}
            <TableCell>
              {payment.subaccountCode
                ? payment.tenantShareKobo == null
                  ? "N/A"
                  : formatNaira(payment.tenantShareKobo)
                : formatNaira(payment.amount)}
            </TableCell>
            <TableCell>
              {payment.subaccountCode
                ? payment.platformShareKobo == null
                  ? "N/A"
                  : formatNaira(payment.platformShareKobo)
                : "-"}
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
 * footer and the cards above it do not jump - the same arrangement the
 * hotspot users list uses.
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
