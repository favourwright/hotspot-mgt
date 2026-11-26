"use client"

import { useState } from "react"
import { AlertCircle, CircleAlert, Loader2 } from "lucide-react"

import {
  REVIEW_KIND_LABELS,
  UNFULFILLABLE_REVIEW_KINDS,
  type PaymentReviewView,
} from "@/lib/payment-review-kinds"
import { Badge } from "@/components/ui/badge"
import { Button as UiButton } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { PageHeader } from "@/components/system/page-header"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"
import { formatDate, formatNaira } from "@/lib/utils"

interface PaymentReviewsClientProps {
  initialReviews: PaymentReviewView[]
}

type Action = "fulfil" | "refunded"

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

function canFulfil(review: PaymentReviewView): boolean {
  return !UNFULFILLABLE_REVIEW_KINDS.includes(review.kind)
}

export function PaymentReviewsClient({ initialReviews }: PaymentReviewsClientProps) {
  const [reviews, setReviews] = useState(initialReviews)
  const [pending, setPending] = useState<{ review: PaymentReviewView; action: Action } | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = reviews.filter((r) => !r.resolvedAt)
  const resolved = reviews.filter((r) => r.resolvedAt)

  const ask = (review: PaymentReviewView, action: Action) => {
    setPending({ review, action })
    setNote("")
    setError(null)
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    try {
      const data = await authedFetch("/api/superadmin/payment-reviews", {
        method: "POST",
        body: JSON.stringify({
          reference: pending.review.reference,
          action: pending.action,
          note: note.trim() || undefined,
        }),
      })
      toast.add({
        title:
          pending.action === "refunded"
            ? "Marked as refunded"
            : data?.pending
              ? "Voucher recorded, but the router could not be reached. It is in the tenant's Failed Queue."
              : "Voucher issued and emailed to the customer",
        type: "success",
      })
      setPending(null)
      setReviews(await authedFetch("/api/superadmin/payment-reviews"))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Payment reviews"
        description="Customers who paid and got no voucher, because something stopped the sale after the money moved. Each one needs a decision: issue the voucher anyway, or refund the charge on Monnify's dashboard."
      />

      {open.length === 0 ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CircleAlert />
                </EmptyMedia>
                <EmptyTitle>Nothing waiting</EmptyTitle>
                <EmptyDescription>
                  Every paid charge has a voucher or a decision. New cases
                  land here and are emailed to the platform alert address.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {open.map((review) => (
            <ReviewCard key={review.reference} review={review}>
              <div className="flex gap-2">
                {canFulfil(review) && (
                  <UiButton size="sm" onClick={() => ask(review, "fulfil")}>
                    Fulfil anyway
                  </UiButton>
                )}
                <UiButton size="sm" variant="outline" onClick={() => ask(review, "refunded")}>
                  Mark refunded
                </UiButton>
              </div>
              {!canFulfil(review) && (
                <p className="text-xs text-muted-foreground">
                  There is nothing left to issue a voucher against. Refund it
                  on Monnify&apos;s dashboard, then mark it here.
                </p>
              )}
            </ReviewCard>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Resolved</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {resolved.map((review) => (
              <ReviewCard key={review.reference} review={review} />
            ))}
          </div>
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent className="sm:max-w-137.5">
          <DialogHeader>
            <DialogTitle>
              {pending?.action === "refunded" ? "Mark as Refunded" : "Fulfil Anyway"}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "refunded"
                ? "Refund the charge on Monnify's dashboard first. This records that you did, and stops the reconcile job from ever issuing a voucher for it."
                : `Issues the voucher as if the check had passed ("${pending ? REVIEW_KIND_LABELS[pending.review.kind] : ""}"), and emails the customer their code. The money is kept.`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Note</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                pending?.action === "refunded"
                  ? "Refunded on Monnify, customer told by phone"
                  : "Owner confirmed the plan was switched off by mistake"
              }
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Optional. Kept on the review for whoever looks at it next.
            </p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex flex-row">
            <UiButton
              variant="outline"
              onClick={() => setPending(null)}
              disabled={busy}
              className="flex-1"
            >
              Cancel
            </UiButton>
            <UiButton disabled={busy} onClick={confirm} className="flex-1">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {pending?.action === "refunded" ? "Mark Refunded" : "Issue Voucher"}
            </UiButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ReviewCard({
  review,
  children,
}: {
  review: PaymentReviewView
  children?: React.ReactNode
}) {
  const badge = review.resolution
    ? { label: review.resolution === "fulfilled" ? "Fulfilled" : "Refunded", variant: "secondary" as const }
    : { label: REVIEW_KIND_LABELS[review.kind] ?? review.kind, variant: "destructive" as const }

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <SurfaceCardTitle className="truncate font-mono">{review.reference}</SurfaceCardTitle>
            <SurfaceCardDescription>
              {review.businessName ?? review.tenantId}
            </SurfaceCardDescription>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </SurfaceCardHeader>

      <SurfaceCardContent className="space-y-3 text-sm">
        <Row label="Amount" value={review.currency === "NGN" ? formatNaira(review.amountKobo) : `${review.amountKobo} ${review.currency} (minor units)`} />
        <Row label="Customer" value={review.chargedEmail || "Unknown"} />
        <Row label="Paid" value={review.createdAt ? formatDate(review.createdAt) : "Unknown"} />
        <Row label="Why" value={review.detail} />
        {review.resolvedAt && (
          <>
            <Row label="Resolved" value={`${formatDate(review.resolvedAt)}${review.resolvedBy ? ` by ${review.resolvedBy}` : ""}`} />
            {review.resolutionNote && <Row label="Note" value={review.resolutionNote} />}
          </>
        )}
        {children}
      </SurfaceCardContent>
    </SurfaceCard>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right font-medium break-words">{value}</span>
    </div>
  )
}
