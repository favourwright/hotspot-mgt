"use client"

import type { User } from "@firebase/auth"

/**
 * Reports a billing payment (a plan period, an addon or credits) once Monnify's checkout has
 * returned, and waits a little if Knomad Pay has not seen it settle yet. The server
 * checks it with the gateway and applies it once (lib/billing-charges.ts); if this gives
 * up, Knomad Pay's event or the reconcile cron applies it anyway, so the message says so.
 */
export async function confirmBillingPayment(
  user: User | null,
  reference: string,
  { attempts = 10, waitMs = 3000 }: { attempts?: number; waitMs?: number } = {}
): Promise<
  | { ok: true; paidThrough: string | null; kind: string | null; credits: number | null }
  | { ok: false; error: string }
> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const token = await user?.getIdToken()
      const response = await fetch(`/api/admin/billing/charges/${encodeURIComponent(reference)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await response.json()
      if (json.success) {
        return {
          ok: true,
          paidThrough: json.data?.paidThrough ?? null,
          kind: json.data?.kind ?? null,
          credits: json.data?.credits ?? null,
        }
      }
      if (!json.pending) return { ok: false, error: json.error || "The payment could not be applied." }
    } catch {
      // A network slip: try again, as for a payment not seen yet.
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  return {
    ok: false,
    error:
      "We haven't received confirmation of this payment yet. If you were charged, it will show here within a few minutes: there is no need to pay again.",
  }
}
