"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader2 } from "lucide-react"

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
import { toast } from "@/components/ui/toast"
import { useAuth } from "@/providers/auth-provider"
import { usePaystackInline } from "@/hooks/use-paystack"
import { describeFeeDiscount, formatNaira } from "@/lib/utils"

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

      pay({
        key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY!,
        email: user.email,
        amount: prepared.amount,
        plan: prepared.planCode,
        onSuccess: async (transaction: { reference: string }) => {
          try {
            await authedFetch({
              method: "POST",
              body: JSON.stringify({
                paystackReference: transaction.reference,
              }),
            })
            toast.add({ title: "Your plan is active", type: "success" })
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
      ? "View plan"
      : "Continue your plan"

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isCancelling ? "Cancel your subscription" : planName}
            </DialogTitle>
            <DialogDescription>
              {isCancelling
                ? "You keep everything you have already paid for."
                : status === "waived"
                  ? discount.full
                    ? "Your plan fee is currently waived."
                    : "Your plan fee is currently discounted."
                  : "Pay your plan fee to continue."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {status === "waived" && (
              <p className="text-sm text-muted-foreground">
                {waiverEndsAt
                  ? `Your ${formatNaira(monthlyFee)} plan fee is ${discount.label} until ${new Date(waiverEndsAt).toLocaleDateString()}. After that the full fee applies.`
                  : `Your ${formatNaira(monthlyFee)} plan fee is ${discount.label}.`}
              </p>
            )}

            {status === "payment-due" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Your plan fee of {formatNaira(monthlyFee)} is due. Paying
                  starts your subscription, and it renews automatically from
                  then on.
                </p>
                <p className="text-xs text-muted-foreground">
                  Your vouchers, customers and routers are untouched either
                  way. Nothing stops working while this is outstanding.
                </p>
              </>
            )}

            {isCancelling && (
              <>
                <p className="text-sm text-muted-foreground">
                  Your plan stays active
                  {nextBillingDate
                    ? ` until ${new Date(nextBillingDate).toLocaleDateString()}`
                    : " until the end of the period you have paid for"}
                  . It simply will not renew after that. Your vouchers,
                  customers and routers are not affected.
                </p>
                <div className="space-y-1.5">
                  <Label>
                    Type{" "}
                    <span className="font-medium">{businessName}</span> to
                    confirm
                  </Label>
                  <Input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={businessName}
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {status === "waived" ? "Close" : "Never mind"}
            </Button>

            {status === "payment-due" && (
              <Button disabled={busy} onClick={startPayment}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Pay {formatNaira(monthlyFee)}
              </Button>
            )}

            {isCancelling && (
              <Button
                variant="destructive"
                disabled={busy || confirmText.trim() !== businessName}
                onClick={cancelSubscription}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                Cancel subscription
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
