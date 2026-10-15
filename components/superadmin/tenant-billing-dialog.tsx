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
import { formatNaira } from "@/lib/utils"

interface TenantBillingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tenantId: string | null
  /** Refetches the tenants list after anything that changes it. */
  onChanged: () => void
}

interface Waiver {
  id: string
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
  billing: { effectiveMonthlyFee: number; planMonthlyFee: number } | null
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
  const [waiverPermanent, setWaiverPermanent] = useState(false)
  const [waiverReason, setWaiverReason] = useState("")

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
      setWaiverPermanent(false)
      setWaiverReason("")
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Billing{data ? ` - ${data.tenant.businessName}` : ""}
          </DialogTitle>
          <DialogDescription>
            Plan, fee waivers and addon grants for this tenant.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {loading || !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading billing...
            </div>
          ) : (
            <>
              {/* What is true right now, before any control to change it. */}
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
                        <span className="line-through text-muted-foreground">
                          {formatNaira(data.tenant.monthlyFee)}
                        </span>{" "}
                        Waived
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
                      says {data.tenant.platformFeePercent}%. Paystack is what
                      actually moves the money. Sync it below once you are sure
                      the plan is right.
                    </AlertDescription>
                  </Alert>
                )}

              {/* ── Plan ─────────────────────────────────────────── */}
              <div className="space-y-2">
                <Label>Plan</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SystemButton
                        tone="field"
                        scale="sm"
                        className="w-full justify-between"
                      >
                        {selectedPlan
                          ? `${selectedPlan.name}${selectedPlan.active ? "" : " (not selectable)"}`
                          : "Select a plan"}
                        <ChevronDown className="size-4" />
                      </SystemButton>
                    }
                  />
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
                  Changing this re-snapshots the fee and commission on the
                  tenant. It does not touch Paystack, so their actual split
                  stays as it is until you sync it below.
                </p>
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

              {/* ── Paystack split ───────────────────────────────── */}
              <div className="space-y-2">
                <Label>Paystack split</Label>
                <p className="text-xs text-muted-foreground">
                  Sets the subaccount&apos;s percentage to this tenant&apos;s
                  current {data.tenant.platformFeePercent}%. This is the only
                  action here that changes what they are actually paid, and it
                  applies to their next sale.
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

              {/* ── Fee waiver ───────────────────────────────────── */}
              <div className="space-y-2">
                <Label>Plan fee waiver</Label>
                {activeWaiver ? (
                  <Panel tone="raised" className="space-y-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span>
                        Waived ({activeWaiver.source})
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
                          toast.add({ title: "Waiver ended", type: "success" })
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
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Waives the plan fee only. The {data.tenant.platformFeePercent}%
                      commission on voucher sales is unaffected - that is a
                      Paystack split, set above.
                    </p>
                    {/* The one thing that would make a waiver a lie. Paystack
                        drives recurring charges off its own subscription, so
                        waiving the fee here does not stop one that is already
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
                    <div className="flex items-center gap-2">
                      <Input
                        type="date"
                        value={waiverEndsAt}
                        disabled={waiverPermanent}
                        onChange={(e) => setWaiverEndsAt(e.target.value)}
                      />
                      <SystemButton
                        tone={waiverPermanent ? "accent" : "raised"}
                        onClick={() => setWaiverPermanent((v) => !v)}
                        className="shrink-0"
                      >
                        No end date
                      </SystemButton>
                    </div>
                    <Input
                      placeholder="Reason, for the audit trail"
                      value={waiverReason}
                      onChange={(e) => setWaiverReason(e.target.value)}
                    />
                    <Button
                      size="sm"
                      disabled={
                        busy !== null || (!waiverPermanent && !waiverEndsAt)
                      }
                      onClick={() =>
                        run("waiver", async () => {
                          await authedFetch(
                            `/api/superadmin/tenants/${tenantId}/waivers`,
                            {
                              method: "POST",
                              body: JSON.stringify({
                                endsAt: waiverPermanent
                                  ? null
                                  : new Date(
                                      `${waiverEndsAt}T23:59:59`
                                    ).toISOString(),
                                source: "manual",
                                couponCode: null,
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
                  </div>
                )}
              </div>

              {/* ── Addons ───────────────────────────────────────── */}
              <div className="space-y-2">
                <Label>Addons</Label>
                {data.entitlements.map((ent) => (
                  <div
                    key={ent.addonKey}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {ent.addonKey}
                      </p>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
