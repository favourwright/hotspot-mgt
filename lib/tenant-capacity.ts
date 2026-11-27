/**
 * Creating something a tenant may only have so many of, without two
 * simultaneous requests both fitting into the last seat.
 *
 * Every limit on how many of a thing a tenant holds (routers, locations, the
 * one decision hook, webhook endpoints, active API keys) used to be a count
 * followed by a separate write. Two requests that counted before either wrote
 * both passed. For routers a connection test sat between the two, so the
 * window was seconds wide, not milliseconds.
 *
 * Here the count and the write happen in one transaction that also reads and
 * writes a per-tenant lock document for that resource. Two such transactions
 * touch the same document, so Firestore runs them one after the other: the
 * loser is retried, and on the retry its count includes the winner's write.
 * The lock rather than the count alone, because what a count query protects
 * against a document inserted beside it is not something to rely on.
 *
 * Every create of a limited resource must go through here, including the
 * ones with no limit on the tenant's plan: an unlimited create that skipped
 * the lock would still race a limited one after a plan change.
 */

import { FieldValue } from "firebase-admin/firestore";
import { AuthError } from "@/lib/auth-helpers";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";

export type CapacityResource = "routers" | "locations" | "hooks" | "webhookEndpoints" | "apiKeys";

/** An `AuthError`, so every route's existing error mapping returns its status. */
export class CapacityError extends AuthError {
  constructor(message: string, status: number = 409) {
    super(message, status);
    this.name = "CapacityError";
  }
}

export interface CapacityCheck {
  /** The query whose `count()` is what the limit is measured against. */
  counted: FirebaseFirestore.Query;
  /** `null` is unlimited. */
  allowed: number | null;
  /** What the caller is told when there is no room. */
  fullMessage: string;
  /** Defaults to 409. Plan limits use 403. */
  fullStatus?: number;
}

/** Pure, so the boundary can be tested without Firestore: `null` is unlimited, never zero. */
export function hasRoom(current: number, allowed: number | null): boolean {
  return allowed === null || current < allowed;
}

/**
 * Runs `write` in a transaction only if every check has room, counted inside
 * that transaction. `extra` is for checks that are not a count (one location
 * per router, say): it runs after the lock is held and before `write`, and
 * throws to refuse. Transactions are retried, so neither callback may have
 * side effects outside `tx`.
 */
export async function createWithinCapacity<T>(params: {
  tenantId: string;
  resource: CapacityResource;
  checks: CapacityCheck[];
  extra?: (tx: FirebaseFirestore.Transaction) => Promise<void>;
  write: (tx: FirebaseFirestore.Transaction) => T;
}): Promise<T> {
  const lockRef = adminDb
    .collection(TENANT_COLLECTIONS.capacityLocks(params.tenantId))
    .doc(params.resource);

  try {
    return await runCapacityTransaction(lockRef, params);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // Contention that outlasted every retry: many creates of one resource at
    // once (a script, or a button held down). The limit held; this one simply
    // did not get its turn. Firestore reports it as ABORTED, or, from the
    // emulator, as a transaction that is "invalid or closed".
    const code = (error as { code?: number }).code;
    if (code === 10 || (code === 3 && /invalid or closed/i.test(String((error as Error).message)))) {
      throw new CapacityError("Too many changes at once. Please try again.", 409);
    }
    throw error;
  }
}

async function runCapacityTransaction<T>(
  lockRef: FirebaseFirestore.DocumentReference,
  params: Parameters<typeof createWithinCapacity<T>>[0]
): Promise<T> {
  return adminDb.runTransaction(async (tx) => {
    // First, and always: this read is what puts two creates in a queue.
    await tx.get(lockRef);

    for (const check of params.checks) {
      if (check.allowed === null) continue;
      const snap = await tx.get(check.counted.count());
      if (!hasRoom(snap.data().count, check.allowed)) {
        throw new CapacityError(check.fullMessage, check.fullStatus ?? 409);
      }
    }
    if (params.extra) await params.extra(tx);

    const result = params.write(tx);
    tx.set(lockRef, { updatedAt: FieldValue.serverTimestamp() });
    return result;
  }, { maxAttempts: 10 });
}
