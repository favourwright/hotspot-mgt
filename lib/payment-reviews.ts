/**
 * Reading and resolving `paymentReviews`: charges that cleared and that
 * fulfilment could not honour automatically.
 *
 * Every review ends one of two ways, and both are a person's decision:
 *
 *  - **fulfilled**: the superadmin overrules the check that stopped it (a
 *    plan switched off mid-checkout, an amount that does not match) and the
 *    ordinary fulfilment runs with that check waived;
 *  - **refunded**: the money goes back through Paystack's dashboard, and the
 *    reference is added to `reconcileSkips` so nothing ever tries to fulfil
 *    it again.
 *
 * Refunding itself is not done from here on purpose. It is irreversible and
 * Paystack's own dashboard already shows the charge, the customer and the
 * split; this page records that it happened.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyCharge } from "@/lib/charge-gateway";
import { fulfilVoucherPurchase, paymentDocId } from "@/lib/voucher-fulfilment";
import { FieldValue } from "firebase-admin/firestore";
import {
  UNFULFILLABLE_REVIEW_KINDS,
  type PaymentReviewKind,
  type PaymentReviewView,
} from "@/lib/payment-review-kinds";

/** Newest first. Bounded: reviews should be rare, and a hundred is a backlog. */
const LIST_LIMIT = 100;

export async function listPaymentReviews(): Promise<PaymentReviewView[]> {
  const snap = await adminDb
    .collection(COLLECTIONS.PAYMENT_REVIEWS)
    .orderBy("createdAt", "desc")
    .limit(LIST_LIMIT)
    .get();

  // One batched read for every business named, rather than one per row.
  const tenantIds = [
    ...new Set(
      snap.docs
        .map((d) => d.data().tenantId)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    ),
  ];
  const names = new Map<string, string>();
  if (tenantIds.length > 0) {
    const tenants = await adminDb.getAll(
      ...tenantIds.map((id) => adminDb.collection(COLLECTIONS.TENANTS).doc(id))
    );
    for (const t of tenants) {
      const name = t.data()?.businessName;
      if (typeof name === "string") names.set(t.id, name);
    }
  }

  return snap.docs.map((doc) => {
    const d = doc.data();
    return {
      reference: d.reference ?? doc.id,
      tenantId: d.tenantId ?? "",
      businessName: names.get(d.tenantId) ?? null,
      kind: d.kind as PaymentReviewKind,
      detail: d.detail ?? "",
      amountKobo: typeof d.amountKobo === "number" ? d.amountKobo : 0,
      currency: d.currency ?? "NGN",
      chargedEmail: d.chargedEmail ?? "",
      buyerUid: d.buyerUid ?? null,
      planId: d.planId ?? null,
      locationId: d.locationId ?? null,
      createdAt: iso(d.createdAt),
      resolvedAt: iso(d.resolvedAt),
      resolution: d.resolution ?? null,
      resolutionNote: d.resolutionNote ?? null,
      resolvedBy: d.resolvedBy ?? null,
      voucherId: d.voucherId ?? null,
    };
  });
}

export class ReviewError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Honours a reviewed charge: runs fulfilment with the overrulable checks
 * waived. Idempotent, like fulfilment itself, so a double click issues one
 * voucher.
 */
export async function fulfilReviewedPayment(args: {
  reference: string;
  note: string | null;
  resolvedBy: string;
}): Promise<{ voucherId: string | undefined; pending: boolean }> {
  const ref = reviewRef(args.reference);
  const review = await openReview(ref);

  if (UNFULFILLABLE_REVIEW_KINDS.includes(review.kind)) {
    throw new ReviewError(
      "Nothing left to issue a voucher against. Refund it instead.",
      400
    );
  }

  // Reviews recorded before they carried the sale fall back to the charge's
  // own metadata, which is what the webhook would have used.
  let { buyerUid, buyerEmail, planId, locationId } = review;
  let deviceMac = review.deviceMac;
  if (!buyerUid || !planId || !locationId) {
    const charge = await verifyCharge(args.reference);
    const meta = (charge.data?.metadata ?? {}) as Record<string, unknown>;
    buyerUid ??= typeof meta.userId === "string" ? meta.userId : null;
    planId ??= typeof meta.planId === "string" ? meta.planId : null;
    locationId ??= typeof meta.locationId === "string" ? meta.locationId : null;
    deviceMac ??= typeof meta.deviceMac === "string" ? meta.deviceMac : null;
    buyerEmail ??= review.chargedEmail;
  }
  if (!buyerUid || !planId || !locationId) {
    throw new ReviewError(
      "This charge does not say who bought it or what for. Refund it, or fulfil it by hand.",
      400
    );
  }

  const result = await fulfilVoucherPurchase(
    {
      reference: args.reference,
      tenantId: review.tenantId,
      planId,
      locationId,
      deviceMac,
      // No device to log in: the buyer left the portal long ago.
      deviceIp: null,
      buyer: { uid: buyerUid, email: buyerEmail ?? review.chargedEmail },
    },
    { overrideReview: true }
  );

  if (!result.ok) throw new ReviewError(result.error, result.status);
  if (result.outcome === "in_progress") {
    throw new ReviewError(
      "This charge is being fulfilled right now. Refresh in a minute.",
      409
    );
  }

  await ref.update({
    resolvedAt: FieldValue.serverTimestamp(),
    resolution: "fulfilled",
    resolutionNote: args.note,
    resolvedBy: args.resolvedBy,
    voucherId: result.voucherId ?? null,
  });

  return { voucherId: result.voucherId, pending: result.outcome === "pending" };
}

/**
 * Records that a reviewed charge was refunded in Paystack, and makes sure
 * the reconcile cron never fulfils it. Both writes in one transaction: a
 * review marked refunded with no skip would be a voucher waiting to happen.
 */
export async function markReviewRefunded(args: {
  reference: string;
  note: string | null;
  resolvedBy: string;
}): Promise<void> {
  const ref = reviewRef(args.reference);
  const skipRef = adminDb
    .collection(COLLECTIONS.RECONCILE_SKIPS)
    .doc(args.reference);

  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ReviewError("Review not found", 404);
    if (snap.data()?.resolvedAt) {
      throw new ReviewError("Already resolved", 409);
    }
    tx.update(ref, {
      resolvedAt: FieldValue.serverTimestamp(),
      resolution: "refunded",
      resolutionNote: args.note,
      resolvedBy: args.resolvedBy,
    });
    tx.set(skipRef, {
      reason: "refunded from payment review",
      note: args.note,
      createdBy: args.resolvedBy,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
}

function reviewRef(reference: string) {
  return adminDb
    .collection(COLLECTIONS.PAYMENT_REVIEWS)
    .doc(paymentDocId(reference));
}

async function openReview(ref: FirebaseFirestore.DocumentReference) {
  const snap = await ref.get();
  if (!snap.exists) throw new ReviewError("Review not found", 404);
  const d = snap.data()!;
  if (d.resolvedAt) throw new ReviewError("Already resolved", 409);
  return {
    kind: d.kind as PaymentReviewKind,
    tenantId: d.tenantId as string,
    chargedEmail: (d.chargedEmail as string) ?? "",
    buyerUid: (d.buyerUid as string | undefined) ?? null,
    buyerEmail: (d.buyerEmail as string | undefined) ?? null,
    planId: (d.planId as string | undefined) ?? null,
    locationId: (d.locationId as string | undefined) ?? null,
    deviceMac: (d.deviceMac as string | undefined) ?? null,
  };
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return null;
}
