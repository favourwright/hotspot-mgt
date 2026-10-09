"use client"

import { useMemo } from "react"

import { Tenant } from "@/types/schemas"
import type { TenantEarnings } from "@/lib/firestore-helpers"
import { Badge } from "@/components/ui/badge"
import { Amount } from "@/components/system/amount"
import { StatCard } from "@/components/system/stat-card"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  AlertTriangle,
  CreditCard,
  Info,
  Percent,
  TrendingUp,
} from "lucide-react"

interface BillingClientProps {
  tenants: Tenant[]
  earnings: Record<string, TenantEarnings>
  mrr: number
  lifetimeCommission: number
  todayCommission: number
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`
}

const EMPTY_EARNINGS: TenantEarnings = {
  grossKobo: 0,
  platformShareKobo: 0,
  paymentCount: 0,
}

export function BillingClient({
  tenants,
  earnings,
  mrr,
  lifetimeCommission,
  todayCommission,
}: BillingClientProps) {
  const pastDueTenants = tenants.filter(
    (t) => t.subscriptionStatus === "past_due"
  )

  /**
   * Sorted by what the tenant is actually worth - subscription plus
   * commission - so the table opens on the tenants that matter rather than
   * on whoever signed up most recently.
   */
  const rows = useMemo(() => {
    return tenants
      .map((tenant) => {
        const earned = earnings[tenant.id] ?? EMPTY_EARNINGS
        return {
          tenant,
          earned,
          // A tenant selling vouchers without a Paystack subaccount settles
          // the whole charge into the platform's own account, and
          // /api/payment/verify records platformShareKobo as 0 for it. The
          // zero is real bookkeeping, but it is not "we earned nothing" -
          // flag it rather than let it read as a fact.
          unattributed:
            !tenant.paystackSubaccountCode && earned.paymentCount > 0,
          total: tenant.monthlyFee + earned.platformShareKobo,
        }
      })
      .sort((a, b) => b.total - a.total)
  }, [tenants, earnings])

  const subscribedCount = tenants.filter((t) => t.monthlyFee > 0).length
  const earningCount = rows.filter((r) => r.earned.paymentCount > 0).length

  const getSubStatusVariant = (status: string | null) => {
    switch (status) {
      case "active":
        return "default"
      case "past_due":
        return "destructive"
      case "cancelled":
        return "secondary"
      case "pending":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Subscription revenue"
          value={formatNaira(mrr)}
          description={`MRR from ${subscribedCount} ${
            subscribedCount === 1 ? "tenant" : "tenants"
          } on a paid plan`}
          icon={TrendingUp}
        />
        <StatCard
          title="Voucher commission"
          value={formatNaira(lifetimeCommission)}
          description={`${formatNaira(todayCommission)} today, across ${earningCount} selling ${
            earningCount === 1 ? "tenant" : "tenants"
          }`}
          icon={Percent}
        />
        <StatCard
          title="Tenants"
          value={tenants.length}
          description="Every tenant, on any plan"
          icon={CreditCard}
        />
      </div>

      {pastDueTenants.length > 0 && (
        <SurfaceCard>
          <SurfaceCardHeader>
            {/* Tone carried by the icon tile and the inset fill rather than
                a ring -- the system draws no borders. */}
            <SurfaceCardTitle className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/15 text-destructive">
                <AlertTriangle className="size-4" />
              </span>
              Past due ({pastDueTenants.length})
            </SurfaceCardTitle>
            <SurfaceCardDescription>
              These tenants have failed subscription payments. Consider
              suspending their accounts.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
          <SurfaceCardContent
            insetBackground="rgba(0,0,0,0.04)"
            className="space-y-2 text-sm"
          >
            {pastDueTenants.map((tenant) => (
              <div
                key={tenant.id}
                className="flex items-center justify-between"
              >
                <span className="font-medium">{tenant.businessName}</span>
                <span className="text-muted-foreground">
                  {formatNaira(tenant.monthlyFee)}/mo
                </span>
              </div>
            ))}
          </SurfaceCardContent>
        </SurfaceCard>
      )}

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>Tenant earnings</SurfaceCardTitle>
          <SurfaceCardDescription>
            Both money flows per tenant: what they pay on their plan, and the
            platform&apos;s share of their voucher sales.
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CreditCard />
                </EmptyMedia>
                <EmptyTitle>No tenants yet</EmptyTitle>
                <EmptyDescription>
                  Tenants appear here as soon as they finish onboarding.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Business</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Monthly fee</TableHead>
                  <TableHead className="text-right">Voucher sales</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead className="text-right">Total to platform</TableHead>
                  <TableHead>Sub status</TableHead>
                  <TableHead>Next billing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ tenant, earned, unattributed, total }) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">
                      {tenant.businessName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tenant.planName}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {tenant.monthlyFee > 0 ? (
                        <Amount value={formatNaira(tenant.monthlyFee)} />
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {earned.paymentCount > 0 ? (
                        <>
                          <Amount value={formatNaira(earned.grossKobo)} />
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({earned.paymentCount})
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {unattributed ? (
                        <Tooltip>
                          <TooltipTrigger className="inline-flex items-center gap-1 text-muted-foreground">
                            <Info className="size-3.5" />
                            Unattributed
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            This tenant has no Paystack subaccount, so no split
                            is recorded on their payments &mdash; the full{" "}
                            {formatNaira(earned.grossKobo)} settled into the
                            platform account rather than being shared.
                          </TooltipContent>
                        </Tooltip>
                      ) : earned.platformShareKobo > 0 ? (
                        <Amount
                          value={formatNaira(earned.platformShareKobo)}
                        />
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {total > 0 ? (
                        <Amount value={formatNaira(total)} />
                      ) : (
                        <span className="text-muted-foreground">&mdash;</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={getSubStatusVariant(tenant.subscriptionStatus)}
                      >
                        {tenant.subscriptionStatus || "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tenant.nextBillingDate
                        ? new Date(tenant.nextBillingDate).toLocaleDateString()
                        : "N/A"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>
    </div>
  )
}
