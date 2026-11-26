"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { toast } from "@/components/ui/toast"
import { useAuth } from "@/providers/auth-provider"

/** A bank as /api/onboarding/banks lists it: Knomad Pay's (Monnify's) list. */
interface BankOption {
  name: string
  code: string
}

interface PayoutAccountCardProps {
  bankName: string | null
  accountLast4: string | null
  accountName: string | null
  /** Whether their share of each sale can be split to them yet. */
  payeeReady: boolean
  /** False for a superadmin viewing someone else's settings: state, no buttons. */
  canManage: boolean
}

/**
 * Where the tenant's share of each voucher sale is paid, and the way to change it. The
 * server names the account by its bank and switches over only once the new payee exists
 * (lib/payout-account.ts); the owner is emailed whenever it changes.
 */
export function PayoutAccountCard({ bankName, accountLast4, accountName, payeeReady, canManage }: PayoutAccountCardProps) {
  const router = useRouter()
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [banks, setBanks] = useState<BankOption[] | null>(null)
  const [bank, setBank] = useState<BankOption | null>(null)
  const [accountNumber, setAccountNumber] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || banks) return
    fetch("/api/onboarding/banks")
      .then((r) => r.json())
      .then((json) => (json.success ? setBanks(json.data) : setError("We couldn't load the bank list. Please try again.")))
      .catch(() => setError("We couldn't load the bank list. Please try again."))
  }, [open, banks])

  // A bank list can name the same bank more than once; the picker needs one per code.
  const uniqueBanks = useMemo(
    () => (banks ?? []).filter((b, i, all) => i === all.findIndex((x) => x.code === b.code)),
    [banks]
  )

  const save = async () => {
    if (!bank) return
    setBusy(true)
    setError(null)
    try {
      const token = await user?.getIdToken()
      const response = await fetch("/api/admin/payout-account", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bankCode: bank.code, accountNumber }),
      })
      const json = await response.json()
      if (!json.success) throw new Error(json.error || "Couldn't change the payout account")
      setOpen(false)
      setAccountNumber("")
      setBank(null)
      toast.add({
        title: "Payout account changed",
        description: json.data.payeeReady
          ? `Sales are now paid to ${json.data.accountName}, ${json.data.bankName}.`
          : `Saved: ${json.data.accountName}, ${json.data.bankName}. Payouts start as soon as it is set up with our payment provider.`,
        type: "success",
      })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the payout account")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SurfaceCard
      action={
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            Change
          </Button>
        ) : null
      }
    >
      <SurfaceCardHeader>
        <SurfaceCardTitle>Payout account</SurfaceCardTitle>
      </SurfaceCardHeader>
      <SurfaceCardContent className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <div className="text-xs text-muted-foreground">Bank</div>
          <div className="font-medium">{bankName ?? "Not set"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Account</div>
          <div className="font-medium">
            {accountLast4 ? `ending ${accountLast4}` : "Not set"}
            {accountName ? <div className="text-xs text-muted-foreground">{accountName}</div> : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <Badge variant={payeeReady ? "secondary" : "destructive"}>
            {payeeReady ? "Receiving payouts" : "Not set up yet: sales paused"}
          </Badge>
        </div>
      </SurfaceCardContent>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>Change payout account</DialogTitle>
            <DialogDescription>
              Your share of each voucher sale is paid into this account. We check it with your bank, and you
              will get an email confirming the change.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="payout-bank">Bank</Label>
              {banks === null && !error ? (
                <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading banks...
                </div>
              ) : (
                <Combobox
                  items={uniqueBanks}
                  itemToStringLabel={(b: BankOption) => b.name}
                  value={bank}
                  onValueChange={(b: BankOption | null) => setBank(b)}
                >
                  <ComboboxInput id="payout-bank" placeholder="Search for your bank..." showClear={Boolean(bank)} />
                  <ComboboxContent>
                    <ComboboxEmpty>No bank matches that name.</ComboboxEmpty>
                    <ComboboxList>
                      {(b: BankOption) => (
                        <ComboboxItem key={b.code} value={b}>
                          {b.name}
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-account">Account number</Label>
              <Input
                id="payout-account"
                inputMode="numeric"
                maxLength={10}
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))}
                placeholder="10 digits"
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex flex-row">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy} className="flex-1">
              Never mind
            </Button>
            <Button onClick={save} disabled={busy || !bank || accountNumber.length !== 10} className="flex-1">
              {busy ? "Checking..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SurfaceCard>
  )
}
