"use client"

import { useState } from "react"
import { AlertCircle, Loader2, Plus, Ticket } from "lucide-react"

import { Coupon } from "@/types/schemas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import { Button as UiButton } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
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
import { PageHeader } from "@/components/system/page-header"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

interface CouponsClientProps {
  initialCoupons: Coupon[]
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

function redemptionLabel(coupon: Coupon): string {
  if (coupon.maxRedemptions === null) {
    return `${coupon.timesRedeemed} redeemed`
  }
  return `${coupon.timesRedeemed} of ${coupon.maxRedemptions} redeemed`
}

export function CouponsClient({ initialCoupons }: CouponsClientProps) {
  const [coupons, setCoupons] = useState(initialCoupons)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [code, setCode] = useState("")
  const [description, setDescription] = useState("")
  const [durationDays, setDurationDays] = useState("30")
  const [limited, setLimited] = useState(false)
  const [maxRedemptions, setMaxRedemptions] = useState("50")
  const [expiresAt, setExpiresAt] = useState("")

  const reload = async () => {
    setCoupons(await authedFetch("/api/superadmin/coupons"))
  }

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(null)
    }
  }

  const create = () =>
    run("create", async () => {
      await authedFetch("/api/superadmin/coupons", {
        method: "POST",
        body: JSON.stringify({
          code,
          description,
          durationDays: Number(durationDays || 0),
          maxRedemptions: limited ? Number(maxRedemptions || 0) || null : null,
          expiresAt: expiresAt
            ? new Date(`${expiresAt}T23:59:59`).toISOString()
            : null,
          active: true,
        }),
      })
      toast.add({ title: "Code created", type: "success" })
      setDialogOpen(false)
      setCode("")
      setDescription("")
      setExpiresAt("")
    })

  return (
    <>
      <PageHeader
        title="Promo codes"
        description="Waive a new tenant's plan fee for a fixed window. The platform's commission on voucher sales is never waived."
        action={
          <Button tone="action" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            New code
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {coupons.length === 0 ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Ticket />
                </EmptyMedia>
                <EmptyTitle>No promo codes yet</EmptyTitle>
                <EmptyDescription>
                  A code waives the plan fee for a set number of days from
                  signup. Until one exists, none can be redeemed.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {coupons.map((coupon) => (
            <SurfaceCard key={coupon.code}>
              <SurfaceCardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <SurfaceCardTitle className="font-mono">
                      {coupon.code}
                    </SurfaceCardTitle>
                    <SurfaceCardDescription>
                      {coupon.durationDays} days free
                      {coupon.description ? ` - ${coupon.description}` : ""}
                    </SurfaceCardDescription>
                  </div>
                  <Badge variant={coupon.active ? "default" : "secondary"}>
                    {coupon.active ? "Active" : "Off"}
                  </Badge>
                </div>
              </SurfaceCardHeader>

              <SurfaceCardContent className="space-y-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Redemptions</span>
                  <span className="font-medium">{redemptionLabel(coupon)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Code expires</span>
                  <span className="font-medium">
                    {coupon.expiresAt
                      ? new Date(coupon.expiresAt).toLocaleDateString()
                      : "Never"}
                  </span>
                </div>

                <div className="flex gap-2">
                  <UiButton
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() =>
                      run(`toggle:${coupon.code}`, async () => {
                        await authedFetch("/api/superadmin/coupons", {
                          method: "PATCH",
                          body: JSON.stringify({
                            code: coupon.code,
                            active: !coupon.active,
                          }),
                        })
                        toast.add({
                          title: coupon.active
                            ? "Code switched off"
                            : "Code switched on",
                          type: "success",
                        })
                      })
                    }
                  >
                    {busy === `toggle:${coupon.code}` && (
                      <Loader2 className="size-4 animate-spin" />
                    )}
                    {coupon.active ? "Switch off" : "Switch on"}
                  </UiButton>

                  {/* Only an unused code can go. A redeemed one is the only
                      record of why somebody's fee is waived. */}
                  {coupon.timesRedeemed === 0 && (
                    <UiButton
                      size="sm"
                      variant="destructive"
                      disabled={busy !== null}
                      onClick={() =>
                        run(`delete:${coupon.code}`, async () => {
                          await authedFetch(
                            `/api/superadmin/coupons?code=${encodeURIComponent(coupon.code)}`,
                            { method: "DELETE" }
                          )
                          toast.add({ title: "Code deleted", type: "success" })
                        })
                      }
                    >
                      {busy === `delete:${coupon.code}` && (
                        <Loader2 className="size-4 animate-spin" />
                      )}
                      Delete
                    </UiButton>
                  )}
                </div>
              </SurfaceCardContent>
            </SurfaceCard>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>New Promo Code</DialogTitle>
            <DialogDescription>
              Waives the plan fee for new signups that enter it. The
              platform&apos;s commission on voucher sales is never waived.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Basic Info</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="LAUNCH30"
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">
                    Letters, numbers and hyphens.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Free Days</Label>
                  <Input
                    type="number"
                    min={1}
                    max={730}
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Counted from signup. Not editable later.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Instagram launch campaign"
                />
                <p className="text-xs text-muted-foreground">
                  For your own reference. Never shown to a tenant.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Limits</h3>
              <p className="text-xs text-muted-foreground">
                Both optional. Without either, the code works for anyone until
                you switch it off.
              </p>
              {/* Label at one end, controls at the other - the same justified
                  row the billing plan dialog's Limits section uses. */}
              <div className="flex items-center justify-between gap-3">
                <Label className="shrink-0">Redemptions</Label>
                <div className="flex items-center gap-3">
                  <Input
                    type="number"
                    min={1}
                    className="w-28"
                    placeholder={limited ? "e.g. 50" : "Unlimited"}
                    value={maxRedemptions}
                    disabled={!limited}
                    onChange={(e) => setMaxRedemptions(e.target.value)}
                  />
                  <Switch checked={limited} onCheckedChange={setLimited} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Code Stops Working On</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for no expiry. This is when the code can no
                  longer be redeemed, not when a tenant&apos;s free days end.
                </p>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex flex-row">
            <UiButton
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={busy !== null}
              className="flex-1"
            >
              Cancel
            </UiButton>
            <UiButton
              disabled={busy !== null || code.trim().length < 3}
              onClick={create}
              className="flex-1"
            >
              {busy === "create" ? "Creating..." : "Create Code"}
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
