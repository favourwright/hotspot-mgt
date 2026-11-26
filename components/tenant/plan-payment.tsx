"use client"

import { useState } from "react"
import { AlertCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
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
import { leaveForCheckout } from "@/lib/checkout-return"
import { useAuth } from "@/providers/auth-provider"
import { describeFeeDiscount, formatDay, formatNaira } from "@/lib/utils"
import type { PlanFeeStatus } from "@/lib/billing-periods"

interface PlanPaymentProps {
  status: PlanFeeStatus
  monthlyFee: number
  planName: string
  /** What paying now would cost (before any passed-on fee) and cover; null when nothing can be paid now. */
  quote: { amountKobo: number; discountKobo: number; from: string; to: string } | null
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
 * The Billing plan card's payment button, and the dialog behind it.
 *
 * Each payment buys one period (lib/billing-periods.ts): from now when the fee is owed,
 * from the end of a free trial when paying during one, or from the end of the paid time
 * when renewing in its last week. Nothing renews by itself, so there is nothing to
 * cancel. What can be paid, and for how much, is decided by the server (`quote`).
 */
export function PlanPayment({ status, monthlyFee, planName, quote, locked, canManage }: PlanPaymentProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canManage || !quote) return null

  const startPayment = async () => {
    setBusy(true)
    setError(null)
    try {
      const token = await user?.getIdToken()
      const response = await fetch("/api/admin/billing/payment", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await response.json()
      if (!json.success) throw new Error(json.error || "Could not start the payment")
      // Monnify's checkout, full screen; it comes back to this tenant's /payment-return,
      // which applies the payment and returns to settings. `busy` stays on: the page is
      // leaving.
      leaveForCheckout(json.data.checkoutUrl, json.data.reference, { kind: "billing", back: "settings" })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the payment")
      setBusy(false)
    }
  }

  const discount = describeFeeDiscount(monthlyFee, quote.discountKobo)
  const label =
    status === "waived" ? "Pay early" : status === "paid" ? "Renew" : locked ? "Pay now" : "Continue your plan"

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return
          setOpen(next)
        }}
      >
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>{planName}</DialogTitle>
            <DialogDescription>
              {status === "waived"
                ? "Your plan fee is waived for now. You can pay for the month after it without losing a day of it."
                : status === "paid"
                  ? "Pay for your next month now, and it starts when this one ends."
                  : locked
                    ? "New sales are paused until this is paid."
                    : "Pay your plan fee to continue."}
            </DialogDescription>
          </DialogHeader>

          {(
            <div className="-mx-6 no-scrollbar max-h-[60vh] space-y-6 overflow-y-auto px-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">This payment</h3>
                <Panel className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Plan</span>
                    <span className="font-medium">{planName}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Monthly fee</span>
                    <span className="font-medium">
                      {quote.discountKobo > 0 ? (
                        <>
                          <span className="text-muted-foreground line-through">{formatNaira(monthlyFee)}</span>{" "}
                          {formatNaira(quote.amountKobo)} ({discount.label})
                        </>
                      ) : (
                        formatNaira(quote.amountKobo)
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Covers</span>
                    <span className="font-medium">
                      {formatDay(new Date(quote.from))} to {formatDay(new Date(quote.to))}
                    </span>
                  </div>
                </Panel>
                <p className="text-xs text-muted-foreground">
                  {locked
                    ? "Vouchers you have already sold keep working, and nothing has been deleted. Paying switches new sales back on straight away."
                    : "Nothing is charged automatically. We email you before each month ends, and you pay for the next one here, by card or bank transfer."}
                </p>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {(
            <DialogFooter className="flex flex-row">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy} className="flex-1">
                Never mind
              </Button>
              <Button disabled={busy} onClick={startPayment} className="flex-1">
                {busy ? "Opening payment..." : `Pay ${formatNaira(quote.amountKobo)}`}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
