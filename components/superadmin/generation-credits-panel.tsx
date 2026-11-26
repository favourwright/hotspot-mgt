"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"
import { formatDate, formatNaira } from "@/lib/utils"

interface Quota {
  cycleStart: string
  cycleEnd: string
  allowance: number | null
  usedThisCycle: number
  credits: number
  available: number | null
  planName: string | null
}

interface LedgerEntry {
  id: string
  delta: number
  kind: "grant" | "consume" | "release" | "deduct"
  batchId: string | null
  note: string | null
  byEmail: string | null
  amountReceivedKobo: number | null
  createdAt: string
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

const KIND_LABEL: Record<LedgerEntry["kind"], string> = {
  grant: "Granted",
  deduct: "Deducted",
  consume: "Used",
  release: "Returned",
}

/**
 * A tenant's voucher generation quota, and credits added or taken away by
 * hand. While online payments are down, this is how a top-up is sold.
 */
export function GenerationCreditsPanel({ tenantId }: { tenantId: string }) {
  const [quota, setQuota] = useState<Quota | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [delta, setDelta] = useState("")
  const [note, setNote] = useState("")
  // Naira as typed; sent as kobo. Empty means nothing was paid (a goodwill
  // top-up or a correction), which is not the same as an amount of zero.
  const [amount, setAmount] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchCredits = useCallback(
    () => authedFetch(`/api/superadmin/tenants/${tenantId}/generation-credits`),
    [tenantId]
  )

  const apply = (data: { quota: Quota; ledger: LedgerEntry[] }) => {
    setQuota(data.quota)
    setLedger(data.ledger)
  }

  const load = async () => apply(await fetchCredits())

  useEffect(() => {
    let alive = true
    fetchCredits()
      .then((data) => {
        if (alive) apply(data)
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : "Couldn't load credits")
      })
    return () => {
      alive = false
    }
  }, [fetchCredits])

  const isGrant = Number(delta) > 0
  const amountInvalid = isGrant && amount.trim() !== "" && !(Number(amount) > 0)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const { balance } = await authedFetch(
        `/api/superadmin/tenants/${tenantId}/generation-credits`,
        {
          method: "POST",
          body: JSON.stringify({
            delta: Math.round(Number(delta)),
            note,
            amountReceivedKobo: isGrant && amount.trim() ? Math.round(Number(amount) * 100) : null,
          }),
        }
      )
      toast.add({ title: `Credit balance is now ${balance}`, type: "success" })
      setDelta("")
      setNote("")
      setAmount("")
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change credits")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Voucher generation</h3>
      {!quota ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {quota.allowance === null
            ? "Unlimited on their plan."
            : `${quota.usedThisCycle} of ${quota.allowance} plan codes used this cycle`}
          {" "}({formatDate(quota.cycleStart)} to {formatDate(quota.cycleEnd)}).{" "}
          <span className="font-medium text-foreground">{quota.credits} credits</span> on hand.
        </p>
      )}

      <div className="grid grid-cols-[7rem_8rem_1fr] gap-2">
        <div className="space-y-1">
          <Label>Credits</Label>
          <Input
            type="number"
            placeholder="e.g. 100"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Amount paid (₦)</Label>
          <Input
            type="number"
            placeholder={isGrant || !delta ? "Optional" : "Grants only"}
            value={isGrant || !delta ? amount : ""}
            disabled={!!delta && !isGrant}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Input
            placeholder="e.g. Transfer ref 1234, 100 codes"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A negative number takes credits away. The balance can&apos;t go below zero,
        and every change is kept in the history below. Enter what the tenant paid
        for a grant and it counts as platform income on the billing page; leave it
        empty for a goodwill top-up or a correction.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !delta || Number(delta) === 0 || note.trim().length < 3 || amountInvalid}
        onClick={submit}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {Number(delta) < 0 ? "Deduct credits" : "Grant credits"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {ledger.length > 0 && (
        <ul className="divide-y rounded-md border text-xs">
          {ledger.slice(0, 10).map((entry) => (
            <li key={entry.id} className="flex justify-between gap-2 p-2">
              <span>
                {KIND_LABEL[entry.kind] ?? entry.kind}{" "}
                <span className={entry.delta > 0 ? "text-green-600" : "text-muted-foreground"}>
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                {entry.amountReceivedKobo !== null && (
                  <span className="text-muted-foreground"> for {formatNaira(entry.amountReceivedKobo)}</span>
                )}
                {entry.note && <span className="text-muted-foreground"> - {entry.note}</span>}
              </span>
              <span className="shrink-0 text-muted-foreground">{formatDate(entry.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
