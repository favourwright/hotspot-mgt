"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Payment } from "@/types/schemas"
import { formatDate, formatNaira } from "@/lib/utils"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { ChevronDown, Receipt, Search } from "lucide-react"

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

interface TransactionsClientProps {
  payments: Payment[]
}

export function TransactionsClient({ payments }: TransactionsClientProps) {
  const searchParams = useSearchParams()

  // Filters live in the URL so a reload or a shared link lands on the same
  // view -- same arrangement as the users page.
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("q") ?? "")
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") ?? "all"
  )
  const [paidFrom, setPaidFrom] = useState(() => searchParams.get("from") ?? "")
  const [paidTo, setPaidTo] = useState(() => searchParams.get("to") ?? "")

  // Native history.replaceState rather than router.replace: the latter is a
  // navigation, so every keystroke would re-run this route's server
  // component (auth + the payments query) for a change the client already
  // rendered. Next integrates these calls with useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set("q", searchTerm)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (paidFrom) params.set("from", paidFrom)
    if (paidTo) params.set("to", paidTo)

    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    )
  }, [searchTerm, statusFilter, paidFrom, paidTo])

  const filtered = useMemo(() => {
    let rows = payments

    if (statusFilter !== "all") {
      rows = rows.filter((p) => p.status === statusFilter)
    }

    if (searchTerm) {
      const needle = searchTerm.toLowerCase()
      rows = rows.filter(
        (p) =>
          p.userEmail.toLowerCase().includes(needle) ||
          p.planName.toLowerCase().includes(needle) ||
          p.paystackReference.toLowerCase().includes(needle)
      )
    }

    if (paidFrom || paidTo) {
      const start = paidFrom ? new Date(`${paidFrom}T00:00:00`) : null
      const end = paidTo ? new Date(`${paidTo}T23:59:59.999`) : null

      rows = rows.filter((p) => {
        const paid = new Date(p.createdAt)
        if (start && paid < start) return false
        if (end && paid > end) return false
        return true
      })
    }

    return rows
  }, [payments, searchTerm, statusFilter, paidFrom, paidTo])

  // Only successful charges are money that moved, so the totals ignore the
  // rest however the list is filtered -- a pending row summed in would read
  // as revenue that hasn't arrived.
  const totals = useMemo(() => {
    const succeeded = filtered.filter((p) => p.status === "success")
    return {
      count: succeeded.length,
      gross: succeeded.reduce((sum, p) => sum + p.amount, 0),
      // A charge with no subaccount was never split, so the whole amount is
      // the tenant's. Null means Paystack reported no split for a charge
      // that did name one, which is unknown rather than zero -- left out.
      yours: succeeded.reduce(
        (sum, p) =>
          sum + (p.subaccountCode ? (p.tenantShareKobo ?? 0) : p.amount),
        0
      ),
    }
  }, [filtered])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description={`Complete payment history (${filtered.length} of ${payments.length})`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email, plan or reference..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
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

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Transactions</SurfaceCardTitle>
          <SurfaceCardDescription>
            {totals.count === 0
              ? "No successful payments in this view"
              : `${formatNaira(totals.gross)} charged across ${totals.count} successful ${totals.count === 1 ? "payment" : "payments"} - ${formatNaira(totals.yours)} your share`}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        {/* `inset={false}`: a table runs to the card's edges -- the sunken
            panel is for blocks, not rows. */}
        <SurfaceCardContent inset={false}>
          {payments.length === 0 ? (
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
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No transactions match this search or filter.
            </div>
          ) : (
            <TransactionsTable payments={filtered} />
          )}
        </SurfaceCardContent>
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
