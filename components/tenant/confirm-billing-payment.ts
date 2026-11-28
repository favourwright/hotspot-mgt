"use client"

import type { User } from "@firebase/auth"
import { UNKNOWN_STANDING, worthAskingAgain, type PaymentStanding } from "@/lib/payment-standing"

/**
 * Reports a billing payment (a plan period, an addon or credits) once Monnify's checkout has
 * returned, and asks again for a while if the answer could still change (lib/payment-standing.ts).
 * The server checks it with the gateway and applies it once (lib/billing-charges.ts); if
 * this gives up, Knomad Pay's event or the reconcile cron applies it anyway.
 *
 * Not applied comes back as how the payment stands, or, when the server refused it, as
 * the server's reason (those are the owner's to read).
 */
export async function confirmBillingPayment(
  user: User | null,
  reference: string,
  { attempts = 10, waitMs = 3000 }: { attempts?: number; waitMs?: number } = {}
): Promise<
  | { ok: true; paidThrough: string | null; kind: string | null; credits: number | null }
  | { ok: false; standing: PaymentStanding }
  | { ok: false; error: string }
> {
  let standing: PaymentStanding = UNKNOWN_STANDING
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
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
      if (!json.standing) return { ok: false, error: json.error || "The payment could not be applied." }
      standing = json.standing as PaymentStanding
      if (!worthAskingAgain(standing)) return { ok: false, standing }
    } catch {
      // A network slip: asked again, and unknown if it never clears.
      standing = UNKNOWN_STANDING
    }
  }
  return { ok: false, standing }
}
