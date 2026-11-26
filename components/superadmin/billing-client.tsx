"use client"

import { useMemo, useState } from "react"

import { Tenant } from "@/types/schemas"
import type { TenantEarnings } from "@/lib/firestore-helpers"
import { Badge } from "@/components/ui/badge"
import { formatDay } from "@/lib/utils"
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
  /**
   * Tenants with a live discount on their plan fee, and what it is.
   *
   * `mrr` is a Firestore sum over `monthlyFee`, which a waiver does not
   * touch, so without this the page reports comped and trialling tenants as
   * revenue being collected. The discount itself is only for the label: a
   * tenant inside a discount window has no subscription at all yet, so they
   * contribute nothing to MRR whether the discount is partial or total.
   */
  activeWaivers: Record<
    string,
    { discountType: "percent" | "amount"; discountValue: number }
  >
  mrr: number
  lifetimeCommission: number
  todayCommission: number
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`
}

/**
 * How a live discount reads in one badge. 100% says "waived" rather than
 * "100% off", because that is the word for it everywhere else on the page.
 */
function discountBadge(discount?: {
  discountType: "percent" | "amount"
  discountValue: number
}): string {
  if (!discount) return "waived"
  if (discount.discountType === "amount") {
    return `${formatNaira(discount.discountValue)} off`
  }
  return discount.discountValue >= 100
    ? "waived"
    : `${discount.discountValue}% off`
}

const EMPTY_EARNINGS: TenantEarnings = {
  grossKobo: 0,
  platformShareKobo: 0,
  cashSalesKobo: 0,
  cashSaleCount: 0,
  paymentCount: 0,
}

export function BillingClient({
  tenants,
  earnings,
  activeWaivers,
  mrr,
  lifetimeCommission,
  todayCommission,
}: BillingClientProps) {
  const waived = useMemo(
    () => new Set(Object.keys(activeWaivers)),
    [activeWaivers]
  )

  // Where each tenant's plan stands, from what is stored: nothing renews by itself, so
  // a paid plan is paid up to `nextBillingDate` and owed after it (lib/billing-periods.ts).
  // The tenant's own page has the grace window and lock; this is the overview.
  // Read once, when the page opens: the overview is of that moment.
  const [now] = useState(() => Date.now())
  const planState = (t: (typeof tenants)[number]): "Free" | "Waived" | "Paid" | "Due" => {
    if (!t.monthlyFee) return "Free"
    if (waived.has(t.id)) return "Waived"
    const paidThrough = t.nextBillingDate ? new Date(t.nextBillingDate).getTime() : 0
    return paidThrough > now ? "Paid" : "Due"
  }
  const pastDueTenants = tenants.filter((t) => planState(t) === "Due")

  // What is actually being collected, and what is deliberately not. The
  // aggregation behind `mrr` cannot see waivers, so the adjustment happens
  // here rather than by making every tenant row a read.
  const waivedKobo = tenants
    .filter((t) => waived.has(t.id))
    .reduce((sum, t) => sum + t.monthlyFee, 0)
  const billedMrr = mrr - waivedKobo

  /**
   * Sorted by commission alone, not by commission plus monthly fee. Those
   * two are on different time bases - `monthlyFee` is per month, the
   * commission is all-time - so adding them produces a number that means
   * nothing, and ranking by it ranks tenants by nothing in particular.
   */
  const rows = useMemo(() => {
    return tenants
      .map((tenant) => {
        const earned = earnings[tenant.id] ?? EMPTY_EARNINGS
        return {
          tenant,
          earned,
          // No payee means no sale could be split. Sales are refused then, so
          // this only flags old figures from before the tenant had one.
          unsplit: !tenant.knomadPayeeReference && earned.paymentCount > 0,
        }
      })
      .sort((a, b) => b.earned.platformShareKobo - a.earned.platformShareKobo)
  }, [tenants, earnings])

  // Paying, not merely on a paid plan: a comped tenant is on one and bills
  // nothing.
  const subscribedCount = tenants.filter(
    (t) => t.monthlyFee > 0 && !waived.has(t.id)
  ).length
  const earningCount = rows.filter((r) => r.earned.paymentCount > 0).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Subscription revenue"
          value={formatNaira(billedMrr)}
          description={
            waivedKobo > 0
              ? `MRR from ${subscribedCount} paying ${
                  subscribedCount === 1 ? "tenant" : "tenants"
                }. ${formatNaira(waivedKobo)} waived.`
              : `MRR from ${subscribedCount} ${
                  subscribedCount === 1 ? "tenant" : "tenants"
                } on a paid plan`
          }
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
              These tenants owe their plan fee. New sales pause once the
              grace window runs out; each has been emailed.
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
            platform&apos;s share of their voucher sales. Commission is the
            platform&apos;s share of each sale as it was split, including any
            passed-on processing fee the platform bears - so it can differ from
            the plan&apos;s headline percentage by however far the fee estimate
            missed.
            That gap is the platform&apos;s margin by design, never the
            tenant&apos;s payout. Cash sales are generated codes the tenant
            printed and sold themselves, counted at first use at the
            plan&apos;s price when they were generated. That money never
            passes through the platform, so it carries no commission.
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
                  <TableHead className="text-right">
                    Voucher sales
                    <span className="block text-xs font-normal text-muted-foreground">
                      all time
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    Cash sales
                    <span className="block text-xs font-normal text-muted-foreground">
                      generated codes
                    </span>
                  </TableHead>
                  <TableHead className="text-right">
                    Commission
                    <span className="block text-xs font-normal text-muted-foreground">
                      all time, net
                    </span>
                  </TableHead>
                  <TableHead>Plan fee</TableHead>
                  <TableHead>Paid until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ tenant, earned, unsplit }) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="font-medium">
                      {tenant.businessName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{tenant.planName}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {tenant.monthlyFee > 0 ? (
                        waived.has(tenant.id) ? (
                          // The fee struck through, not hidden: what they
                          // would be paying is the thing you want to see
                          // next to what they are not paying it at.
                          <>
                            <span className="text-muted-foreground line-through">
                              {formatNaira(tenant.monthlyFee)}
                            </span>{" "}
                            <Badge variant="secondary">
                              {discountBadge(activeWaivers[tenant.id])}
                            </Badge>
                          </>
                        ) : (
                          <>
                            <Amount value={formatNaira(tenant.monthlyFee)} />
                            <span className="text-xs text-muted-foreground">
                              /mo
                            </span>
                          </>
                        )
                      ) : (
                        <span className="text-muted-foreground">-</span>
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
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(earned.cashSaleCount ?? 0) > 0 ? (
                        <>
                          <Amount value={formatNaira(earned.cashSalesKobo)} />
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({earned.cashSaleCount})
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {earned.platformShareKobo > 0 ? (
                        <span className="inline-flex items-center gap-1.5">
                          {unsplit && (
                            <Tooltip>
                              <TooltipTrigger
                                aria-label="Not split with the tenant"
                                className="text-muted-foreground"
                              >
                                <Info className="size-3.5" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                This tenant had no payee for these sales, so
                                nothing was split automatically - the
                                full charge settled into the platform account.
                                They are still owed their share, settled
                                off-platform.
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <Amount
                            value={formatNaira(earned.platformShareKobo)}
                          />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={planState(tenant) === "Due" ? "destructive" : planState(tenant) === "Paid" ? "default" : "secondary"}
                      >
                        {planState(tenant)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tenant.nextBillingDate
                        ? formatDay(new Date(tenant.nextBillingDate))
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
