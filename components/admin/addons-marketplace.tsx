"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Check, TriangleAlert } from "lucide-react"

import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { PageHeader } from "@/components/system/page-header"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { HostedCheckout, type HostedCheckoutState } from "@/components/shared/hosted-checkout"
import { confirmBillingPayment } from "@/components/tenant/confirm-billing-payment"
import { RENEW_WINDOW_MS } from "@/lib/billing-periods"
import { auth } from "@/lib/firebase"
import { formatNaira } from "@/lib/utils"

export interface MarketplaceAddon {
  key: string
  name: string
  description: string
  pricingModel: "free" | "one_time" | "subscription"
  amount: number
  billingInterval: "monthly" | "yearly"
  entitled: boolean
  reason: string
  endsAt: string | null
  /** False once withdrawn from sale; a holder still sees it, without a button. */
  purchasable: boolean
}

interface AddonsMarketplaceProps {
  addons: MarketplaceAddon[]
}

/**
 * Whether there is something to pay for: not had yet, lapsed, in its grace window, or a
 * paid period in its last week (the same window the server allows: lib/billing-periods.ts).
 */
function canPay(addon: MarketplaceAddon): boolean {
  if (!addon.entitled) return true
  if (addon.pricingModel !== "subscription") return false
  if (addon.reason === "in-grace") return true
  if (addon.reason !== "purchased" || !addon.endsAt) return false
  return new Date(addon.endsAt).getTime() - Date.now() <= RENEW_WINDOW_MS
}

function priceLabel(addon: MarketplaceAddon): string {
  if (addon.pricingModel === "free") return "Free"
  if (addon.pricingModel === "one_time") {
    return `${formatNaira(addon.amount)} once`
  }
  return `${formatNaira(addon.amount)} / ${
    addon.billingInterval === "yearly" ? "year" : "month"
  }`
}

export function AddonsMarketplace({ addons }: AddonsMarketplaceProps) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  // The addon being paid for, with Monnify's checkout for it, shown in a dialog.
  const [paying, setPaying] = useState<{ addon: MarketplaceAddon; checkout: HostedCheckoutState } | null>(null)

  async function buy(addon: MarketplaceAddon) {
    setBusy(addon.key)
    setError("")
    try {
      const token = await auth?.currentUser?.getIdToken()
      // The amount comes from the server, never from this component, and the payment is
      // applied from the server's own record of it (lib/billing-charges.ts).
      const prepared = await fetch(`/api/admin/addons/${addon.key}/checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json())
      if (!prepared.success) {
        setError(prepared.error || "Could not start checkout.")
        return
      }
      setPaying({ addon, checkout: { url: prepared.data.checkoutUrl, reference: prepared.data.reference } })
    } catch {
      setError("Could not start checkout. Please try again.")
    } finally {
      setBusy(null)
    }
  }

  async function onPaid(addon: MarketplaceAddon, reference: string) {
    setPaying(null)
    setBusy(addon.key)
    // Paying is not being entitled: the server checks the payment with the gateway first.
    const result = await confirmBillingPayment(auth?.currentUser ?? null, reference)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast.add({
      title: `${addon.name} is active`,
      description: result.paidThrough
        ? `Paid until ${new Date(result.paidThrough).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`
        : "You can use it right away.",
      type: "success",
    })
    router.refresh()
  }

  return (
    <>
      <PageHeader
        title="Addons"
        description="Extra features for your account. These are billed separately from your plan."
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <TriangleAlert className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {addons.map((addon) => (
          <SurfaceCard key={addon.key}>
            <SurfaceCardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SurfaceCardTitle className="flex items-center gap-2">
                    {addon.name}
                    {addon.entitled && (
                      <Badge variant="secondary" className="gap-1">
                        <Check className="size-3" />
                        {addon.reason === "included-in-plan"
                          ? "In your plan"
                          : "Active"}
                      </Badge>
                    )}
                  </SurfaceCardTitle>
                  <SurfaceCardDescription>
                    {addon.description}
                  </SurfaceCardDescription>
                </div>
                <span className="shrink-0 text-sm font-medium">
                  {priceLabel(addon)}
                </span>
              </div>
            </SurfaceCardHeader>

            <SurfaceCardContent>
              {addon.reason === "in-grace" && addon.endsAt && (
                // Said plainly and early. Finding out that a feature has
                // stopped is a far worse way to learn a payment failed.
                <Alert variant="destructive" className="mb-3">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>
                    The period you paid for has ended. It keeps working until{" "}
                    {new Date(addon.endsAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "long",
                    })}
                    , then stops. Renew it to keep it.
                  </AlertDescription>
                </Alert>
              )}

              {addon.pricingModel === "subscription" &&
                addon.reason === "purchased" &&
                addon.endsAt && (
                  <p className="mb-3 text-sm text-muted-foreground">
                    Paid until{" "}
                    {new Date(addon.endsAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                    . Nothing is charged automatically: renew it in the last week.
                  </p>
                )}

              {addon.purchasable && addon.pricingModel !== "free" && canPay(addon) && (
                <Button
                  tone="action"
                  onClick={() => buy(addon)}
                  disabled={busy === addon.key}
                >
                  {busy === addon.key
                    ? "Starting..."
                    : addon.entitled
                      ? "Renew"
                      : addon.reason === "lapsed" || addon.reason === "cancelled"
                        ? "Reactivate"
                        : `Get ${addon.name}`}
                </Button>
              )}
            </SurfaceCardContent>
          </SurfaceCard>
        ))}

        {addons.length === 0 && (
          <SurfaceCard>
            <SurfaceCardHeader>
              <SurfaceCardTitle>Nothing available yet</SurfaceCardTitle>
              <SurfaceCardDescription>
                There are no addons on offer at the moment.
              </SurfaceCardDescription>
            </SurfaceCardHeader>
          </SurfaceCard>
        )}
      </div>
      <Dialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>{paying?.addon.name}</DialogTitle>
            <DialogDescription>
              {paying ? `${priceLabel(paying.addon)}. Nothing is charged automatically.` : ""}
            </DialogDescription>
          </DialogHeader>
          {paying && (
            <HostedCheckout
              checkout={paying.checkout}
              onPaid={(reference) => void onPaid(paying.addon, reference)}
              onBack={() => setPaying(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
