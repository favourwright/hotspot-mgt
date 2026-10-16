"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Button } from "@/components/ui/button"
import { Button as SystemButton } from "@/components/system/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Panel } from "@/components/system/surface-card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"
import { describeFeeDiscount, formatNaira } from "@/lib/utils"

interface TenantBillingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string | null
  /** Refetches the tenants list after anything that changes it. */
  onChanged: () => void
}

interface Waiver {
  id: string
  discountType: "percent" | "amount"
  discountValue: number
  startsAt: string
  endsAt: string | null
  source: "coupon" | "trial" | "manual"
  couponCode: string | null
  reason: string
  revokedAt: string | null
}

interface BillingData {
  tenant: {
    id: string
    slug: string
    businessName: string
    planId: string
    planName: string
    monthlyFee: number
    platformFeePercent: number
    subscriptionStatus: string | null
    paystackSubaccountCode: string | null
  }
  billing: {
    effectiveMonthlyFee: number
    planMonthlyFee: number
    discountKobo: number
  } | null
  waivers: Waiver[]
  entitlements: {
    addonKey: string
    entitled: boolean
    reason: string
    source: "purchase" | "grant" | null
  }[]
  paystackSplit: { percentageCharge: number | null; error: string | null }
  plans: {
    id: string
    name: string
    monthlyFee: number
    platformFeePercent: number
    active: boolean
  }[]
}

async function authedFetch(url: string, init?: RequestInit) {
  if (!auth?.currentUser) throw new Error("Not authenticated")
  const token = await auth.currentUser.getIdToken()
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  const json = await response.json()
  if (!json.success) throw new Error(json.error || "Request failed")
  return json.data
}

function isActive(waiver: Waiver, now: number): boolean {
  if (waiver.revokedAt) return false
  if (new Date(waiver.startsAt).getTime() > now) return false
  if (waiver.endsAt && new Date(waiver.endsAt).getTime() <= now) return false
  return true
}

export function TenantBillingDialog({
  open,
  onOpenChange,
  tenantId,
  onChanged,
}: TenantBillingDialogProps) {
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [planId, setPlanId] = useState("")
  const [waiverEndsAt, setWaiverEndsAt] = useState("")
  const [waiverReason, setWaiverReason] = useState("")
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    "percent"
  )
  // Percent, or naira. Defaults to a full waiver, which is what comping an
  // account means and what this form is almost always used for.
  const [discountValue, setDiscountValue] = useState("100")

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      const result: BillingData = await authedFetch(
        `/api/superadmin/tenants/${tenantId}/billing`
      )
      setData(result)
      setPlanId(result.tenant.planId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load billing")
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => {
    if (open) {
      setWaiverEndsAt("")
      setWaiverReason("")
      setDiscountType("percent")
      setDiscountValue("100")
      load()
    }
  }, [open, load])

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  const now = Date.now()
  const activeWaiver = data?.waivers.find((w) => isActive(w, now)) ?? null
  const selectedPlan = data?.plans.find((p) => p.id === planId) ?? null
  const planChanged = Boolean(data && planId && planId !== data.tenant.planId)

  // The split Paystack is applying versus what the tenant's plan says it
  // should be. These drift by design, so the gap is worth stating outright
  // rather than leaving someone to compare two numbers on different rows.
  const splitMatchesPlan =
    data?.paystackSplit.percentageCharge !== null &&
    data?.paystackSplit.percentageCharge === data?.tenant.platformFeePercent

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-137.5">
        <DialogHeader>
          <DialogTitle>
            {data ? `Billing - ${data.tenant.businessName}` : "Billing"}
          </DialogTitle>
          <DialogDescription>
            Plan, fee waivers and addon grants for this tenant. Only the
            Paystack split changes what they are actually paid.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
          {loading || !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading billing...
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Current</h3>
                {/* What is true right now, before any control that changes
                    it. A sunken panel because it is a readout, not a field. */}
                <Panel className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">
                      {data.tenant.planName || "Not set"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Plan fee</span>
                    <span className="font-medium">
                      {activeWaiver ? (
                        <>
                          <span className="text-muted-foreground line-through">
                            {formatNaira(data.tenant.monthlyFee)}
                          </span>{" "}
                          {
                            describeFeeDiscount(
                              data.tenant.monthlyFee,
                              data.billing?.discountKobo ?? 0
                            ).label
                          }
                        </>
                      ) : data.tenant.monthlyFee === 0 ? (
                        "Free"
                      ) : (
                        formatNaira(data.tenant.monthlyFee)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      Commission (never waived)
                    </span>
                    <span className="font-medium">
                      {data.tenant.platformFeePercent}%
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">
                      Paystack is applying
                    </span>
                    <span className="font-medium">
                      {data.paystackSplit.error
                        ? "Couldn't reach Paystack"
                        : data.paystackSplit.percentageCharge === null
                          ? "No subaccount"
                          : `${data.paystackSplit.percentageCharge}%`}
                    </span>
                  </div>
                </Panel>

                {!data.paystackSplit.error &&
                  data.paystackSplit.percentageCharge !== null &&
                  !splitMatchesPlan && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Paystack is splitting at{" "}
                        {data.paystackSplit.percentageCharge}% while this plan
                        says {data.tenant.platformFeePercent}%. Paystack is
                        what actually moves the money.
                      </AlertDescription>
                    </Alert>
                  )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Plan</h3>
                <div className="space-y-1.5">
                  <Label>Billing plan</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <SystemButton
                          tone="field"
                          scale="sm"
                          className="w-full justify-between"
                        />
                      }
                    >
                      {selectedPlan
                        ? `${selectedPlan.name}${selectedPlan.active ? "" : " (not selectable)"}`
                        : "Select a plan"}
                      <ChevronDown className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuRadioGroup
                        value={planId}
                        onValueChange={setPlanId}
                      >
                        {data.plans.map((plan) => (
                          <DropdownMenuRadioItem key={plan.id} value={plan.id}>
                            {plan.name} - {plan.platformFeePercent}%
                            {plan.monthlyFee > 0
                              ? ` + ${formatNaira(plan.monthlyFee)}`
                              : ""}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <p className="text-xs text-muted-foreground">
                    Re-snapshots the fee and commission on this tenant. It does
                    not touch Paystack, so their actual split stays as it is
                    until you sync it below.
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={!planChanged || busy !== null}
                  onClick={() =>
                    run("plan", async () => {
                      await authedFetch(
                        `/api/superadmin/tenants/${tenantId}/billing`,
                        { method: "PATCH", body: JSON.stringify({ planId }) }
                      )
                      toast.add({ title: "Plan updated", type: "success" })
                    })
                  }
                >
                  {busy === "plan" && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Change plan
                </Button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Paystack split</h3>
                <p className="text-xs text-muted-foreground">
                  Sets the subaccount&apos;s percentage to this tenant&apos;s
                  current {data.tenant.platformFeePercent}%. This is the only
                  action here that changes what they are actually paid, and it
                  applies from their next sale.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !data.tenant.paystackSubaccountCode}
                  onClick={() =>
                    run("split", async () => {
                      const result = await authedFetch(
                        `/api/superadmin/tenants/${tenantId}/paystack-split`,
                        { method: "POST" }
                      )
                      // Reports what Paystack confirmed, not what we asked
                      // for. A write that silently did not apply is the
                      // failure that would go unnoticed.
                      toast.add({
                        title: result.confirmed
                          ? `Split set to ${result.confirmedPercentage}%`
                          : `Paystack reported ${result.confirmedPercentage}%, not ${result.requestedPercentage}%`,
                        type: result.confirmed ? "success" : "error",
                      })
                    })
                  }
                >
                  {busy === "split" && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  Sync split to Paystack
                </Button>
              </div>

              <hr />

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Plan fee waiver</h3>
                {activeWaiver ? (
                  <Panel className="space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        {activeWaiver.discountValue >= 100 &&
                        activeWaiver.discountType === "percent"
                          ? "Waived"
                          : activeWaiver.discountType === "percent"
                            ? `${activeWaiver.discountValue}% off`
                            : `${formatNaira(activeWaiver.discountValue)} off`}{" "}
                        ({activeWaiver.source})
                        {activeWaiver.couponCode
                          ? ` - ${activeWaiver.couponCode}`
                          : ""}
                      </span>
                      <Badge variant="secondary">
                        {activeWaiver.endsAt
                          ? `until ${new Date(activeWaiver.endsAt).toLocaleDateString()}`
                          : "permanent"}
                      </Badge>
                    </div>
                    {activeWaiver.reason && (
                      <p className="text-xs text-muted-foreground">
                        {activeWaiver.reason}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() =>
                        run("revoke", async () => {
                          await authedFetch(
                            `/api/superadmin/tenants/${tenantId}/waivers`,
                            {
                              method: "DELETE",
                              body: JSON.stringify({
                                waiverId: activeWaiver.id,
                              }),
                            }
                          )
                          toast.add({
                            title: "Waiver ended",
                            type: "success",
                          })
                        })
                      }
                    >
                      {busy === "revoke" && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      End waiver now
                    </Button>
                  </Panel>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Waives the plan fee only. The{" "}
                      {data.tenant.platformFeePercent}% commission on voucher
                      sales is unaffected - that is a Paystack split, set
                      above.
                    </p>
                    {/* The one thing that would make a waiver a lie. Paystack
                        drives recurring charges off its own subscription, so
                        waiving the fee here does not stop one already
                        running. */}
                    {data.tenant.subscriptionStatus === "active" && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                          This tenant has an active Paystack subscription. A
                          waiver records what they owe us, but Paystack will
                          keep charging them on schedule until that
                          subscription is cancelled there. To stop the money,
                          move them to a plan with no fee instead.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Discount</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <SystemButton
                                tone="field"
                                scale="sm"
                                className="w-full justify-between"
                              />
                            }
                          >
                            {discountType === "percent"
                              ? "Percentage"
                              : "Fixed amount"}
                            <ChevronDown className="size-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuRadioGroup
                              value={discountType}
                              onValueChange={(value) => {
                                const next = value as "percent" | "amount"
                                setDiscountType(next)
                                // The number means something different under
                                // the other type, so it resets rather than
                                // silently changing what is being given.
                                setDiscountValue(
                                  next === "percent" ? "100" : ""
                                )
                              }}
                            >
                              <DropdownMenuRadioItem value="percent">
                                Percentage
                              </DropdownMenuRadioItem>
                              <DropdownMenuRadioItem value="amount">
                                Fixed amount
                              </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="space-y-1.5">
                        <Label>
                          {discountType === "percent" ? "Percent" : "Naira off"}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={discountType === "percent" ? 100 : undefined}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder={
                            discountType === "percent" ? "100" : "1000"
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Ends on</Label>
                      <Input
                        type="date"
                        value={waiverEndsAt}
                        onChange={(e) => setWaiverEndsAt(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Required. A comp that never ends belongs on a plan,
                        not a waiver - put the tenant on the company-owned
                        accounts plan instead.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Reason</Label>
                      <Input
                        placeholder="Why this tenant, decided by whom"
                        value={waiverReason}
                        onChange={(e) => setWaiverReason(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Kept on the waiver for the audit trail.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      disabled={
                        busy !== null ||
                        !waiverEndsAt ||
                        !discountValue ||
                        Number(discountValue) < 1
                      }
                      onClick={() =>
                        run("waiver", async () => {
                          await authedFetch(
                            `/api/superadmin/tenants/${tenantId}/waivers`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                endsAt: new Date(
                                  `${waiverEndsAt}T23:59:59`
                                ).toISOString(),
                                source: "manual",
                                couponCode: null,
                                discountType,
                                discountValue:
                                  discountType === "percent"
                                    ? Number(discountValue || 0)
                                    : Math.round(Number(discountValue || 0) * 100),
                                reason: waiverReason,
                              }),
                            }
                          )
                          toast.add({ title: "Fee waived", type: "success" })
                        })
                      }
                    >
                      {busy === "waiver" && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Waive plan fee
                    </Button>
                  </>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Addons</h3>
                {data.entitlements.map((ent) => (
                  <div
                    key={ent.addonKey}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <Label>{ent.addonKey}</Label>
                      <p className="text-xs text-muted-foreground">
                        {ent.reason.replace(/-/g, " ")}
                      </p>
                    </div>
                    {/* Only a grant can be withdrawn here. Free and
                        plan-included come from configuration, and a real
                        purchase has a Paystack subscription behind it that
                        deleting this document would leave running. */}
                    {ent.source === "grant" ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`addon:${ent.addonKey}`, async () => {
                            await authedFetch(
                              `/api/superadmin/tenants/${tenantId}/entitlements`,
                              {
                                method: "DELETE",
                                body: JSON.stringify({
                                  addonKey: ent.addonKey,
                                }),
                              }
                            )
                            toast.add({
                              title: "Grant withdrawn",
                              type: "success",
                            })
                          })
                        }
                      >
                        {busy === `addon:${ent.addonKey}` && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Withdraw
                      </Button>
                    ) : ent.entitled ? (
                      <Badge variant="secondary">Has it</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`addon:${ent.addonKey}`, async () => {
                            await authedFetch(
                              `/api/superadmin/tenants/${tenantId}/entitlements`,
                              {
                                method: "POST",
                                body: JSON.stringify({
                                  addonKey: ent.addonKey,
                                }),
                              }
                            )
                            toast.add({
                              title: "Addon granted",
                              type: "success",
                            })
                          })
                        }
                      >
                        {busy === `addon:${ent.addonKey}` && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Grant
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex flex-row">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
