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
import { usePaystackInline } from "@/hooks/use-paystack"
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
}

interface AddonsMarketplaceProps {
  addons: MarketplaceAddon[]
  ownerEmail: string
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

export function AddonsMarketplace({
  addons,
  ownerEmail,
}: AddonsMarketplaceProps) {
  const router = useRouter()
  const { pay } = usePaystackInline()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function buy(addon: MarketplaceAddon) {
    setBusy(addon.key)
    setError("")

    try {
      const token = await auth?.currentUser?.getIdToken()
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }

      // The amount and plan code come from the server, never from this
      // component: activation re-checks the charge against the addon's live
      // price, so anything decided here would just fail there.
      const prepared = await fetch(`/api/admin/addons/${addon.key}/checkout`, {
        method: "POST",
        headers,
      }).then((r) => r.json())

      if (!prepared.success) {
        setError(prepared.error || "Could not start checkout.")
        return
      }

      pay({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: ownerEmail,
        amount: prepared.data.amount,
        ...(prepared.data.planCode ? { plan: prepared.data.planCode } : {}),
        onSuccess: async (transaction: { reference: string }) => {
          // Paying is not being entitled. The entitlement exists only once
          // the server has verified this reference against Paystack.
          const activated = await fetch(
            `/api/admin/addons/${addon.key}/activate`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ reference: transaction.reference }),
            }
          ).then((r) => r.json())

          if (!activated.success) {
            setError(
              activated.error ||
                "Payment went through but activation failed. Please contact support."
            )
            return
          }

          toast.add({
            title: `${addon.name} is active`,
            description: "You can use it right away.",
            type: "success",
          })
          router.refresh()
        },
        onCancel: () => setBusy(null),
        onError: (err: { message: string }) =>
          setError(err.message || "Payment failed."),
      })
    } catch {
      setError("Could not start checkout. Please try again.")
    } finally {
      setBusy(null)
    }
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
                    We could not take the last payment for this. It keeps
                    working until{" "}
                    {new Date(addon.endsAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "long",
                    })}
                    , then stops. Updating your card with Paystack fixes it.
                  </AlertDescription>
                </Alert>
              )}

              {!addon.entitled && addon.pricingModel !== "free" && (
                <Button
                  tone="action"
                  onClick={() => buy(addon)}
                  disabled={busy === addon.key}
                >
                  {busy === addon.key
                    ? "Starting..."
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
    </>
  )
}
