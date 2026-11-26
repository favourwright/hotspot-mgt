/**
 * `pendingPurchases/{reference}`: what a buyer agreed to pay for, written by
 * /api/purchase/initiate before the charge exists at Knomad Pay.
 *
 * Fulfilment reads the tenant, plan, location, buyer, intent, device and
 * amount from here, never from the request or the charge's metadata. The
 * metadata is still attached to the charge, because the webhook and the
 * reconcile cron use it to find the sale at all, but it decides nothing.
 *
 * Server-side only by rule: a client able to write here could agree to any
 * price it liked.
 */

import type { FeeBearer } from "@/lib/processing-fees";
import { randomBytes } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { newPurchaseReference } from "@/lib/charge-authority";
import type { PurchaseIntent } from "@/lib/voucher-renewal";

/**
 * How long the checkout is considered current. For display and logging
 * only: a charge that lands later with the right amount is still honoured,
 * because by then the money has moved.
 */
const CHECKOUT_WINDOW_MS = 30 * 60 * 1000;

/** Kept for reconciliation, then removed by the reconcile cron's purge. */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface PendingPurchase {
  reference: string;
  tenantId: string;
  userId: string;
  userEmail: string;
  planId: string;
  locationId: string;
  intent: PurchaseIntent;
  deviceMac: string | null;
  deviceIp: string | null;
  /** What the customer is charged: price plus any passed-through fee. */
  amountKobo: number;
  /** The two parts of it, so the split can be checked against what was sent. */
  priceKobo: number;
  feeKobo: number;
  platformShareKobo: number | null;
  currency: "NGN";
  /** The tenant's payee at Knomad Pay the sale was split to; null with no split. */
  payeeReference: string | null;
  bearer: FeeBearer;
  /** Which hook call allowed this checkout, for tracing; null if none ran. */
  hookDecision: { hookId: string; requestId: string; outcome: string } | null;
  createdAt: Date;
  expiresAt: Date;
}

export function mintPurchaseReference(now = Date.now()): string {
  return newPurchaseReference(now, randomBytes(8).toString("hex"));
}

export async function createPendingPurchase(
  record: Omit<PendingPurchase, "createdAt" | "expiresAt">
): Promise<void> {
  const now = Date.now();
  // create(), not set(): a reference is minted once, and a collision would
  // mean two checkouts sharing one record.
  await adminDb
    .collection(COLLECTIONS.PENDING_PURCHASES)
    .doc(record.reference)
    .create({
      ...record,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + CHECKOUT_WINDOW_MS),
      deleteAt: new Date(now + RETENTION_MS),
    });
}

/** The pending purchases started since `sinceMs`, for reconciliation. */
export async function listRecentPendingPurchases(sinceMs: number): Promise<PendingPurchase[]> {
  const snap = await adminDb
    .collection(COLLECTIONS.PENDING_PURCHASES)
    .where("createdAt", ">=", new Date(sinceMs))
    .get();
  return snap.docs.map((doc) => fromStored(doc.data()));
}

export async function getPendingPurchase(
  reference: string
): Promise<PendingPurchase | null> {
  // Only references this app minted can have a record; anything else would
  // not be a valid document id anyway.
  if (!/^hs_\d+_[0-9a-f]{16}$/.test(reference)) return null;

  const doc = await adminDb
    .collection(COLLECTIONS.PENDING_PURCHASES)
    .doc(reference)
    .get();
  if (!doc.exists) return null;

  return fromStored(doc.data()!);
}

function fromStored(d: Record<string, unknown>): PendingPurchase {
  return {
    ...(d as unknown as PendingPurchase),
    createdAt: toDate(d.createdAt),
    expiresAt: toDate(d.expiresAt),
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return new Date(0);
}
