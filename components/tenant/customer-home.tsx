"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardFooter,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Button } from "@/components/system/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Clock, Database, Smartphone } from "lucide-react"
import { LinkStatusToast } from "@/components/shared/link-status-toast"
import { CheckoutDialog } from "@/components/shared/checkout-dialog"
import type { PurchaseOptionsView } from "@/components/shared/purchase-intent-choice"
import { TenantNav } from "@/components/tenant/tenant-nav"
import { AppShell } from "@/components/system/app-shell"
import { PageContent } from "@/components/system/page-content"
import { PageHeader } from "@/components/system/page-header"
import { Greeting } from "@/components/system/greeting"
import { Amount } from "@/components/system/amount"
import { formatDeviceLimit, formatNaira } from "@/lib/utils"
import { useAuth } from "@/providers/auth-provider"
import { Plan, Location } from "@/types/schemas"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { Wifi } from "lucide-react"

interface TenantCustomerHomeProps {
  tenant: {
    id: string
    slug: string
    businessName: string
  }
  plans: Plan[]
  locations: Location[]
}

export function TenantCustomerHome({
  tenant,
  plans,
  locations,
}: TenantCustomerHomeProps) {
  const { user } = useAuth()
  const router = useRouter()
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  // What the can-purchase check said a purchase would do to the logins this
  // customer already holds. Handed straight to the dialog so it can ask
  // "who is this for?" without a second round trip.
  const [purchaseOptions, setPurchaseOptions] =
    useState<PurchaseOptionsView | null>(null)
  // The plan being checked, not a bare boolean: a shared flag put every
  // card's button into "Checking..." at once, so the whole grid looked busy
  // and it was impossible to tell which plan had actually been clicked.
  const [checkingPlanId, setCheckingPlanId] = useState<string | null>(null)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)

  const handleBuyPlan = async (plan: Plan) => {
    // Clicking the same card twice while it is still checking would fire a
    // second request for no reason. A different card is allowed through.
    if (checkingPlanId === plan.id) return
    setBlockedMessage(null)

    if (!user) {
      router.push("/auth")
      return
    }

    // Enforced here, before the checkout ever opens - once a payment
    // succeeds, /api/payment/verify never blocks fulfillment.
    setCheckingPlanId(plan.id)
    try {
      const token = await user.getIdToken()
      // The plan and location go along so the check can also catch "you
      // already have an unused voucher for exactly this", which is a refusal
      // on the customer's behalf rather than the tenant's.
      const response = await fetch(
        `/api/tenant/${tenant.slug}/can-purchase?planId=${encodeURIComponent(
          plan.id
        )}&locationId=${encodeURIComponent(plan.locationId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await response.json()

      if (!response.ok || !data.success) {
        setBlockedMessage(
          "Unable to check availability right now. Please try again."
        )
        return
      }

      if (!data.data.allowed) {
        setBlockedMessage(
          data.data.reason ||
            "This business isn't accepting new customers right now."
        )
        return
      }

      setPurchaseOptions(data.data.options ?? null)
      setSelectedPlan(plan)
      setCheckoutOpen(true)
    } catch (error) {
      console.error("Can-purchase check failed:", error)
      setBlockedMessage(
        "Unable to check availability right now. Please try again."
      )
    } finally {
      // Only clear if this plan is still the one showing, so a slow request
      // finishing after a different card was clicked cannot reset that
      // card's button back to "Buy now" while it is still working.
      setCheckingPlanId((current) => (current === plan.id ? null : current))
    }
  }

  // Group plans by location
  const plansByLocation = locations
    .map((location) => ({
      location,
      plans: plans.filter((plan) => plan.locationId === location.id),
    }))
    .filter((group) => group.plans.length > 0)

  if (plansByLocation.length === 0) {
    return (
      <AppShell>
        <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
        <PageContent>
          <PageHeader
            title={<Greeting />}
            description="Select a plan to get started with internet access"
          />
          <SurfaceCard>
            <SurfaceCardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Wifi />
                  </EmptyMedia>
                  <EmptyTitle>No plans available</EmptyTitle>
                  <EmptyDescription>
                    This portal doesn&apos;t have any active plans yet. Check
                    back later.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </SurfaceCardContent>
          </SurfaceCard>
        </PageContent>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <TenantNav businessName={tenant.businessName} slug={tenant.slug} />
      <LinkStatusToast />

      <PageContent>
        <PageHeader
          title={<Greeting />}
          description="Select a plan to get started with internet access"
        />

        {blockedMessage && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{blockedMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-10">
          {plansByLocation.map(({ location, plans }) => (
            <section key={location.id} className="space-y-4">
              <h2 className="text-xl font-medium tracking-tight">
                {location.name}
              </h2>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => (
                  <SurfaceCard key={plan.id} className="flex flex-col">
                    <SurfaceCardHeader>
                      <SurfaceCardTitle>{plan.name}</SurfaceCardTitle>
                      <SurfaceCardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5 shrink-0" />
                          {plan.duration}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Database className="size-3.5 shrink-0" />
                          {plan.dataLimit || "Unlimited"}
                        </span>
                        {formatDeviceLimit(plan.sharedUsers) && (
                          <span className="inline-flex items-center gap-1.5">
                            <Smartphone className="size-3.5 shrink-0" />
                            {formatDeviceLimit(plan.sharedUsers)}
                          </span>
                        )}
                      </SurfaceCardDescription>
                    </SurfaceCardHeader>
                    <SurfaceCardContent className="flex-1">
                      <Amount
                        value={formatNaira(plan.price)}
                        className="text-3xl font-semibold tracking-tight"
                      />
                    </SurfaceCardContent>
                    <SurfaceCardFooter>
                      <Button
                        tone="accent"
                        className="w-full"
                        onClick={() => handleBuyPlan(plan)}
                        // Only the clicked card reacts. Disabling the whole
                        // grid off one value is the same bug as labelling it
                        // off one value: the other plans are not busy, and
                        // greying them out says they are.
                        disabled={checkingPlanId === plan.id}
                      >
                        {checkingPlanId === plan.id ? "Checking..." : "Buy now"}
                      </Button>
                    </SurfaceCardFooter>
                  </SurfaceCard>
                ))}
              </div>
            </section>
          ))}
        </div>
      </PageContent>

      {selectedPlan && (
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          plan={selectedPlan}
          tenantSlug={tenant.slug}
          options={purchaseOptions}
        />
      )}
    </AppShell>
  )
}
