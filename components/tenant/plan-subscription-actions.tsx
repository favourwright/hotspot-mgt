"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Panel } from "@/components/system/surface-card"
import { toast } from "@/components/ui/toast"
import { useAuth } from "@/providers/auth-provider"
import { usePaystackInline } from "@/hooks/use-paystack"
import { describeFeeDiscount, formatDay, formatNaira } from "@/lib/utils"

export type PlanFeeStatus =
  | "no-fee"
  | "waived"
  | "subscribed"
  | "past-due"
  | "payment-due"

interface PlanSubscriptionActionsProps {
  status: PlanFeeStatus
  monthlyFee: number
  /** What a live waiver takes off that fee, in kobo. */
  discountKobo: number
  planName: string
  businessName: string
  waiverEndsAt: string | null
  nextBillingDate: string | null
  /**
   * Whether the grace window has already run out. Only changes what this
   * says, never what it offers - paying is the way out of the lock, so the
   * button it is reached by must not be locked behind it.
   */
  locked: boolean
  /** False for a superadmin viewing someone else's settings: state, no buttons. */
  canManage: boolean
}

/**
 * The Billing plan card's single action, and the dialog behind it.
 *
 * Two jobs, because they are two directions of the same thing: paying to
 * start or resume a plan, and cancelling one that is running. Which one
 * shows is decided by the server-resolved status, never by the browser.
 */
export function PlanSubscriptionActions({
  status,
  monthlyFee,
  discountKobo,
  planName,
  businessName,
  waiverEndsAt,
  nextBillingDate,
  locked,
  canManage,
}: PlanSubscriptionActionsProps) {
  const router = useRouter()
  const { user } = useAuth()
  const { pay } = usePaystackInline()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState("")

  // Nothing to do, and nothing worth a button, when the plan is free or
  // Paystack is already retrying a card of its own accord.
  if (!canManage || status === "no-fee" || status === "past-due") return null

  const authedFetch = async (init?: RequestInit) => {
    const token = await user?.getIdToken()
    const response = await fetch("/api/admin/billing/subscription", {
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

  const startPayment = async () => {
    if (!user?.email) return
    setBusy(true)
    setError(null)
    try {
      const prepared = await authedFetch()
      const isPrepay = prepared.mode === "prepay"

      pay({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: user.email,
        amount: prepared.amount,
        // A Plan code subscribes, and subscribing charges today. That is
        // right when the fee is already owed and wrong when it is not: a
        // tenant paying during their trial would lose the free days they
        // are paying to keep. So a prepayment is a plain amount, and the
        // recurring half is scheduled server-side once this clears.
        ...(isPrepay
          ? { metadata: { purpose: prepared.purpose } }
          : { plan: prepared.planCode }),
        onSuccess: async (transaction: { reference: string }) => {
          try {
            const result = await authedFetch({
              method: "POST",
              body: JSON.stringify({
                paystackReference: transaction.reference,
                intent: isPrepay ? "prepay" : "subscribe",
              }),
            })
            toast.add({
              title: isPrepay ? "You're paid up" : "Your plan is active",
              // `scheduled: false` means the charge landed but Paystack
              // would not take a card token, so renewal is not set up. Said
              // out loud rather than swallowed - the alternative is a tenant
              // who believes they are on autopay and is not.
              description:
                result?.notice ??
                (isPrepay
                  ? "Your free days are untouched. Billing starts after they end."
                  : undefined),
              type: "success",
            })
            setOpen(false)
            router.refresh()
          } catch (err) {
            // The charge went through; only our record of it did not. Say
            // so rather than implying they need to pay again.
            setError(
              err instanceof Error
                ? `Payment went through but we couldn't record it: ${err.message}`
                : "Payment went through but we couldn't record it."
            )
          }
        },
        onCancel: () => {},
        onError: (err: { message: string }) =>
          setError(err.message || "Payment failed. Please try again."),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start payment")
    } finally {
      setBusy(false)
    }
  }

  const cancelSubscription = async () => {
    setBusy(true)
    setError(null)
    try {
      await authedFetch({ method: "DELETE" })
      toast.add({
        title: "Cancellation sent to Paystack",
        description: "It can take a moment to show here.",
        type: "success",
      })
      setOpen(false)
      setConfirmText("")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't cancel")
    } finally {
      setBusy(false)
    }
  }

  const discount = describeFeeDiscount(monthlyFee, discountKobo)
  const isCancelling = status === "subscribed"
  const label = isCancelling
    ? "Manage subscription"
    : status === "waived"
      ? "Pay early"
      : locked
        ? "Pay now"
        : "Continue your plan"

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>
              {isCancelling ? "Cancel your subscription" : planName}
            </DialogTitle>
            <DialogDescription>
              {isCancelling
                ? "You keep everything you have already paid for."
                : status === "waived"
                  ? discount.full
                    ? "Your plan fee is waived for now. You can settle up early without losing a day of it."
                    : "Your plan fee is discounted for now. You can settle up early without losing a day of it."
                  : locked
                    ? "New sales are paused until this is paid."
                    : "Pay your plan fee to continue."}
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Your plan</h3>
              {/* A readout, not fields - the same sunken panel the
                  superadmin billing dialog opens with. */}
              <Panel className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-medium">{planName}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Monthly fee</span>
                  <span className="font-medium">
                    {status === "waived" ? (
                      <>
                        <span className="text-muted-foreground line-through">
                          {formatNaira(monthlyFee)}
                        </span>{" "}
                        {discount.label}
                      </>
                    ) : (
                      formatNaira(monthlyFee)
                    )}
                  </span>
                </div>
                {status === "waived" && waiverEndsAt && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Full fee from</span>
                    <span className="font-medium">
                      {formatDay(new Date(waiverEndsAt))}
                    </span>
                  </div>
                )}
                {isCancelling && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Active until</span>
                    <span className="font-medium">
                      {nextBillingDate
                        ? formatDay(new Date(nextBillingDate))
                        : "End of the period you have paid for"}
                    </span>
                  </div>
                )}
              </Panel>

              <p className="text-xs text-muted-foreground">
                {isCancelling
                  ? "Cancelling stops it renewing. Your vouchers, customers and routers are not affected."
                  : status === "waived"
                    ? "Paying now buys the first month after your free period, so none of it is wasted. Billing then renews from that point."
                    : locked
                      ? "Vouchers you have already sold keep working, and nothing has been deleted. Paying switches new sales back on straight away."
                      : "Vouchers you have already sold keep working. New sales pause if this stays unpaid."}
              </p>
            </div>

            {(status === "payment-due" || status === "waived") && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Payment</h3>
                <p className="text-xs text-muted-foreground">
                  {status === "waived"
                    ? waiverEndsAt
                      ? `This covers the month beginning ${formatDay(new Date(waiverEndsAt))}, and renews automatically after that.`
                      : "This covers the month after your free period, and renews automatically after that."
                    : "Paying starts your subscription, and it renews automatically from then on."}
                </p>
              </div>
            )}

            {isCancelling && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Confirm</h3>
                <div className="space-y-1.5">
                  <Label>
                    Type <span className="font-medium">{businessName}</span> to
                    confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={businessName}
                  />
                  <p className="text-xs text-muted-foreground">
                    Asked for because this is a billing change people make by
                    accident.
                  </p>
                </div>
              </div>
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
              onClick={() => setOpen(false)}
              disabled={busy}
              className="flex-1"
            >
              {"Never mind"}
            </Button>

            {(status === "payment-due" || status === "waived") && (
              <Button disabled={busy} onClick={startPayment} className="flex-1">
                {busy ? "Preparing..." : `Pay ${formatNaira(monthlyFee)}`}
              </Button>
            )}

            {isCancelling && (
              <Button
                variant="destructive"
                disabled={busy || confirmText.trim() !== businessName}
                onClick={cancelSubscription}
                className="flex-1"
              >
                {busy ? "Cancelling..." : "Cancel subscription"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
