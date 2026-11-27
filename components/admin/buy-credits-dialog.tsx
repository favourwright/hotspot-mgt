"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { auth } from "@/lib/firebase"
import { leaveForCheckout } from "@/lib/checkout-return"
import { formatNaira } from "@/lib/utils"

interface BuyCreditsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Kobo per credit, from platform config. */
  priceKobo: number
  minCredits: number
  maxCredits: number
}

/**
 * Buying top-up credits online. The total here is only a preview: the server
 * works the price out again from the platform's config, adds any processing
 * fee, and the credits are added from its own record once the payment is
 * applied (lib/billing-charges.ts), not from anything this sends back.
 */
export function BuyCreditsDialog({ open, onOpenChange, priceKobo, minCredits, maxCredits }: BuyCreditsDialogProps) {
  const [credits, setCredits] = useState(String(minCredits))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const count = Math.round(Number(credits))
  const valid = Number.isInteger(count) && count >= minCredits && count <= maxCredits

  async function buy() {
    setBusy(true)
    setError("")
    try {
      const token = await auth?.currentUser?.getIdToken()
      const prepared = await fetch("/api/admin/voucher-generation/credits/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ credits: count }),
      }).then((r) => r.json())
      if (!prepared.success) {
        setError(prepared.error || "Could not start checkout.")
        setBusy(false)
        return
      }
      // Full screen, like every other checkout; the return page applies the
      // payment and comes back to Generate codes. `busy` stays on: the page
      // is leaving.
      leaveForCheckout(prepared.data.checkoutUrl, prepared.data.reference, { kind: "billing", back: "generate" })
    } catch {
      setError("Could not start checkout. Please try again.")
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setCredits(String(minCredits))
          setError("")
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Buy top-up credits</DialogTitle>
          <DialogDescription>
            One credit generates one code. Credits are used after your plan&apos;s codes for the
            cycle, and they never expire.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="buy-credits">Credits</Label>
          <Input
            id="buy-credits"
            type="number"
            min={minCredits}
            max={maxCredits}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            {valid
              ? `${formatNaira(count * priceKobo)} at ${formatNaira(priceKobo)} each. Any processing fee is shown at checkout.`
              : `Between ${minCredits} and ${maxCredits} credits, at ${formatNaira(priceKobo)} each.`}
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={buy} disabled={busy || !valid}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {valid ? `Pay ${formatNaira(count * priceKobo)}` : "Pay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
