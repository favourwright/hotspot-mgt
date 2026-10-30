/**
 * Outbound webhooks: telling a tenant's server that something happened,
 * instead of making it poll the API.
 *
 * ## Shape
 *
 *  - `tenants/{t}/webhookEndpoints/{id}`: where to send, which events, an
 *    encrypted signing secret (same scheme as decision hooks).
 *  - `webhookEvents/{eventId}`: one per fact. The id is derived from the
 *    event type and its subject, so the three paths that can fulfil one sale
 *    produce one event, not three.
 *  - `webhookDeliveries/{eventId}_{endpointId}`: one per endpoint per event,
 *    each with its own attempts, schedule and outcome.
 *
 * ## Delivery
 *
 * At least once. The first attempt runs straight after the event, in
 * `after()`; the `webhook-deliver` cron picks up everything due a retry,
 * backing off over about a day (lib/webhook-events.ts). A short lease on the
 * delivery stops the fast path and the cron sending the same one at once.
 * Through `safeFetch`, so a tenant's URL can only reach the public internet.
 *
 * An endpoint that accepts nothing for three days is switched off and its
 * owner emailed: unlike a decision hook, nothing at the moment of sale
 * depends on it, and the data is still in the API.
 *
 * ## Cost
 *
 * Nothing is written for a tenant with no active endpoint wanting the event,
 * or without the API Access addon. The project is on Spark; events for
 * nobody would be a write quota spent on nothing.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { createDocCache } from "@/lib/doc-cache";
import { hasApiAccess } from "@/lib/api-access";
import { safeFetch, SafeFetchError, type SafeFetchOptions, type SafeFetchResponse } from "@/lib/safe-fetch";
import { SIGNATURE_HEADER, signatureHeader } from "@/lib/hook-signing";
import { decryptHookSecret } from "@/lib/hook-secrets";
import {
  MAX_DELIVERY_ATTEMPTS,
  TEST_EVENT_TYPE,
  endpointWants,
  nextAttemptDelayMs,
  shouldDisableEndpoint,
  webhookBody,
  webhookEventId,
  type WebhookEventType,
} from "@/lib/webhook-events";
import { notifyWebhookDisabled } from "@/lib/notifications";
import { after } from "next/server";
import { parsePayment, parseVoucher } from "@/lib/firestore-helpers";
import { publicPayment, publicVoucher } from "@/lib/public-api-serializers";

export const MAX_ENDPOINTS = 5;
const RETENTION_MS = 30 * 24 * 3600_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const DELIVERY_LEASE_MS = 60_000;

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;
  description: string;
  /** Empty means every event. */
  events: string[];
  secretCiphertext: string;
  secretKeyVersion: number;
  previousSecretCiphertext: string | null;
  previousSecretKeyVersion: number | null;
  previousSecretExpiresAt: Date | null;
  active: boolean;
  disabledReason: string | null;
  /** First failure since the last success; cleared by any success. */
  failingSince: Date | null;
  createdAt: Date | null;
}

export interface WebhookEndpointView {
  id: string;
  url: string;
  description: string;
  events: string[];
  active: boolean;
  disabledReason: string | null;
  failingSince: string | null;
  rotating: boolean;
  createdAt: string | null;
}

export type DeliveryStatus = "pending" | "succeeded" | "failed" | "cancelled";

export interface DeliveryAttemptResult {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
}

/* ------------------------------------------------ endpoints */

const endpointsCache = createDocCache<WebhookEndpoint[]>(60_000);

export function listTenantEndpoints(tenantId: string): Promise<WebhookEndpoint[]> {
  return endpointsCache.get(tenantId, async () => {
    const snap = await adminDb
      .collection(TENANT_COLLECTIONS.webhookEndpoints(tenantId))
      .limit(MAX_ENDPOINTS * 2)
      .get();
    return snap.docs.map((d) => endpointFromData(d.id, tenantId, d.data()));
  });
}

/** Every write to an endpoint calls this (lib/doc-cache.ts contract). */
export function invalidateTenantEndpoints(tenantId: string): void {
  endpointsCache.invalidate(tenantId);
}

export function endpointRef(tenantId: string, id: string) {
  return adminDb.collection(TENANT_COLLECTIONS.webhookEndpoints(tenantId)).doc(id);
}

export function endpointView(e: WebhookEndpoint): WebhookEndpointView {
  return {
    id: e.id,
    url: e.url,
    description: e.description,
    events: e.events,
    active: e.active,
    disabledReason: e.disabledReason,
    failingSince: e.failingSince?.toISOString() ?? null,
    rotating: rotating(e, Date.now()),
    createdAt: e.createdAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------ emitting */

export interface EmitDeps {
  loadEndpoints: (tenantId: string) => Promise<WebhookEndpoint[]>;
  hasAccess: (tenantId: string) => Promise<boolean>;
  /** Runs work after the response; the first delivery attempt goes here. */
  defer: (task: () => Promise<void>) => void;
}

/**
 * Records an event and its deliveries, then tries them straight away.
 * Idempotent: the same type and subject is the same event, so a second call
 * finds it already recorded and does nothing.
 */
export async function emitWebhookEvent(
  event: { tenantId: string; type: WebhookEventType; subjectId: string; data: unknown },
  deps: EmitDeps
): Promise<{ eventId: string | null; deliveries: number }> {
  const endpoints = (await deps.loadEndpoints(event.tenantId)).filter(
    (e) => e.active && endpointWants(e.events, event.type)
  );
  if (endpoints.length === 0) return { eventId: null, deliveries: 0 };
  if (!(await deps.hasAccess(event.tenantId))) return { eventId: null, deliveries: 0 };

  const eventId = webhookEventId(event.type, event.subjectId);
  const now = new Date();
  try {
    await adminDb.collection(COLLECTIONS.WEBHOOK_EVENTS).doc(eventId).create({
      tenantId: event.tenantId,
      type: event.type,
      subjectId: event.subjectId,
      data: event.data,
      createdAt: now,
      deleteAt: new Date(now.getTime() + RETENTION_MS),
    });
  } catch (error) {
    // Already recorded by another path through the same sale.
    if ((error as { code?: number })?.code === 6) return { eventId, deliveries: 0 };
    throw error;
  }

  const ids: string[] = [];
  const batch = adminDb.batch();
  for (const endpoint of endpoints) {
    const id = `${eventId}_${endpoint.id}`;
    ids.push(id);
    batch.set(adminDb.collection(COLLECTIONS.WEBHOOK_DELIVERIES).doc(id), {
      tenantId: event.tenantId,
      endpointId: endpoint.id,
      eventId,
      type: event.type,
      status: "pending" satisfies DeliveryStatus,
      attempts: 0,
      nextAttemptAt: now,
      leaseUntil: null,
      lastStatus: null,
      lastError: null,
      deliveredAt: null,
      createdAt: now,
      deleteAt: new Date(now.getTime() + RETENTION_MS),
    });
  }
  await batch.commit();

  for (const id of ids) deps.defer(() => attemptDelivery(id).then(() => undefined));
  return { eventId, deliveries: ids.length };
}

/* ------------------------------------------------ delivering */

export interface SendDeps {
  fetch: (url: string, options: SafeFetchOptions) => Promise<SafeFetchResponse>;
  now: () => number;
}

const productionSend: SendDeps = { fetch: safeFetch, now: Date.now };

/** One signed POST. Never throws: every failure is a result. */
export async function sendWebhook(
  endpoint: Pick<WebhookEndpoint, "url" | "secretCiphertext" | "secretKeyVersion" | "previousSecretCiphertext" | "previousSecretKeyVersion" | "previousSecretExpiresAt">,
  delivery: { id: string; type: string; attempt: number },
  body: string,
  deps: SendDeps = productionSend
): Promise<DeliveryAttemptResult & { bodyPreview: string | null }> {
  let secrets: string[];
  try {
    secrets = [decryptHookSecret(endpoint.secretCiphertext, endpoint.secretKeyVersion)];
    if (rotating(endpoint, deps.now()) && endpoint.previousSecretCiphertext) {
      secrets.push(decryptHookSecret(endpoint.previousSecretCiphertext, endpoint.previousSecretKeyVersion ?? 1));
    }
  } catch {
    return { ok: false, httpStatus: null, error: "Signing secret unavailable on this server", bodyPreview: null };
  }

  try {
    const response = await deps.fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "OgaWiFi-Webhooks/1",
        "ogawifi-event": delivery.type,
        "ogawifi-delivery": delivery.id,
        "ogawifi-delivery-attempt": String(delivery.attempt),
        [SIGNATURE_HEADER.toLowerCase()]: signatureHeader(secrets, Math.floor(deps.now() / 1000), body),
      },
      body,
      timeoutMs: DELIVERY_TIMEOUT_MS,
      maxBytes: 64 * 1024,
    });
    return {
      ok: response.ok,
      httpStatus: response.status,
      error: response.ok ? null : `HTTP ${response.status}`,
      bodyPreview: response.body.slice(0, 2000),
    };
  } catch (error) {
    const message =
      error instanceof SafeFetchError ? (error.kind === "timeout" ? "Timed out" : error.message) : "Request failed";
    return { ok: false, httpStatus: null, error: message, bodyPreview: null };
  }
}

/**
 * What a delivery becomes after an attempt. Pure: the schedule, giving up,
 * and the endpoint's failing clock, in one place the tests can reach.
 */
export function deliveryOutcome(
  attemptsBefore: number,
  result: DeliveryAttemptResult,
  now: Date
): {
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: Date | null;
} {
  const attempts = attemptsBefore + 1;
  if (result.ok) return { status: "succeeded", attempts, nextAttemptAt: null };
  const delay = nextAttemptDelayMs(attempts);
  return delay === null
    ? { status: "failed", attempts, nextAttemptAt: null }
    : { status: "pending", attempts, nextAttemptAt: new Date(now.getTime() + delay) };
}

/**
 * Claims a due delivery, sends it, records the outcome, and keeps the
 * endpoint's failing clock. Safe to call from anywhere at any time: a
 * delivery that is not due, or leased by someone else, is left alone.
 */
export async function attemptDelivery(
  deliveryId: string
): Promise<{ status: DeliveryStatus | "skipped"; result?: DeliveryAttemptResult }> {
  const ref = adminDb.collection(COLLECTIONS.WEBHOOK_DELIVERIES).doc(deliveryId);
  const nowMs = Date.now();

  const claimed = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!d) return null;
    const due = d.status === "pending" && toDate(d.nextAttemptAt)!.getTime() <= nowMs;
    const leased = toDate(d.leaseUntil)?.getTime() ?? 0;
    if (!due || leased > nowMs) return null;
    tx.update(ref, { leaseUntil: new Date(nowMs + DELIVERY_LEASE_MS) });
    return d;
  });
  if (!claimed) return { status: "skipped" };

  const endpoint = (await listTenantEndpoints(claimed.tenantId)).find((e) => e.id === claimed.endpointId);
  if (!endpoint || !endpoint.active) {
    await ref.update({ status: "cancelled", leaseUntil: null });
    return { status: "cancelled" };
  }
  const eventSnap = await adminDb.collection(COLLECTIONS.WEBHOOK_EVENTS).doc(claimed.eventId).get();
  const event = eventSnap.data();
  if (!event) {
    await ref.update({ status: "cancelled", leaseUntil: null, lastError: "Event expired" });
    return { status: "cancelled" };
  }

  const body = webhookBody({ id: claimed.eventId, type: event.type, createdAt: toDate(event.createdAt)!, data: event.data });
  const result = await sendWebhook(endpoint, { id: deliveryId, type: event.type, attempt: claimed.attempts + 1 }, body);
  const now = new Date();
  const outcome = deliveryOutcome(claimed.attempts, result, now);

  await ref.update({
    status: outcome.status,
    attempts: outcome.attempts,
    nextAttemptAt: outcome.nextAttemptAt ?? now,
    leaseUntil: null,
    lastStatus: result.httpStatus,
    lastError: result.error,
    lastAttemptAt: now,
    ...(result.ok ? { deliveredAt: now } : {}),
  });

  await keepFailingClock(endpoint, result.ok, now);
  return { status: outcome.status, result };
}

/** Clears on success; starts on the first failure; disables after three days. */
async function keepFailingClock(endpoint: WebhookEndpoint, ok: boolean, now: Date): Promise<void> {
  const ref = endpointRef(endpoint.tenantId, endpoint.id);
  if (ok) {
    if (endpoint.failingSince) {
      await ref.update({ failingSince: null });
      invalidateTenantEndpoints(endpoint.tenantId);
    }
    return;
  }
  if (!endpoint.failingSince) {
    await ref.update({ failingSince: now });
    invalidateTenantEndpoints(endpoint.tenantId);
    return;
  }
  if (shouldDisableEndpoint(endpoint.failingSince, now)) {
    // Once: the transaction makes the transition, and only the caller who
    // made it sends the email.
    const disabledNow = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.data()?.active) return false;
      tx.update(ref, {
        active: false,
        disabledReason: "Switched off after three days without a successful delivery",
        disabledAt: now,
      });
      return true;
    });
    invalidateTenantEndpoints(endpoint.tenantId);
    if (disabledNow) await notifyWebhookDisabled({ tenantId: endpoint.tenantId, url: endpoint.url });
  }
}

/**
 * The `webhook-deliver` cron: everything due, oldest first, bounded so one
 * tick cannot run past the next. Each delivery is independent; one tenant's
 * dead server cannot stop another tenant's events.
 */
export async function runDueDeliveries(budgetMs = 45_000): Promise<{ attempted: number; succeeded: number; errors: string[] }> {
  const started = Date.now();
  const due = await adminDb
    .collection(COLLECTIONS.WEBHOOK_DELIVERIES)
    .where("status", "==", "pending")
    .where("nextAttemptAt", "<=", new Date())
    .orderBy("nextAttemptAt", "asc")
    .limit(50)
    .get();

  let attempted = 0;
  let succeeded = 0;
  const errors: string[] = [];
  for (const doc of due.docs) {
    if (Date.now() - started > budgetMs) break;
    try {
      const r = await attemptDelivery(doc.id);
      if (r.status === "skipped") continue;
      attempted += 1;
      if (r.status === "succeeded") succeeded += 1;
    } catch (error) {
      errors.push(`${doc.id}: ${String(error)}`);
    }
  }
  return { attempted, succeeded, errors };
}

/** The owner's "Send again": a fresh schedule, attempted now. */
export async function redeliver(tenantId: string, deliveryId: string) {
  const ref = adminDb.collection(COLLECTIONS.WEBHOOK_DELIVERIES).doc(deliveryId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.tenantId !== tenantId) return null;
  await ref.update({ status: "pending", nextAttemptAt: new Date(), leaseUntil: null, attempts: 0 });
  return attemptDelivery(deliveryId);
}

export async function listEndpointDeliveries(endpointId: string, limit = 50) {
  const snap = await adminDb
    .collection(COLLECTIONS.WEBHOOK_DELIVERIES)
    .where("endpointId", "==", endpointId)
    .orderBy("createdAt", "desc")
    .limit(Math.min(limit, 100))
    .get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      type: x.type as string,
      status: x.status as DeliveryStatus,
      attempts: (x.attempts as number) ?? 0,
      lastStatus: (x.lastStatus as number | null) ?? null,
      lastError: (x.lastError as string | null) ?? null,
      nextAttemptAt: toDate(x.nextAttemptAt)?.toISOString() ?? null,
      deliveredAt: toDate(x.deliveredAt)?.toISOString() ?? null,
      createdAt: toDate(x.createdAt)?.toISOString() ?? null,
      maxAttempts: MAX_DELIVERY_ATTEMPTS,
    };
  });
}

/** The owner's "Send test event": signed and real, but not stored or retried. */
export async function sendTestEvent(endpoint: WebhookEndpoint) {
  const id = webhookEventId(TEST_EVENT_TYPE, `${endpoint.id}:${Date.now()}`);
  const body = webhookBody({
    id,
    type: TEST_EVENT_TYPE,
    createdAt: new Date(),
    data: { message: "A test event from your OgaWiFi dashboard." },
  });
  return sendWebhook(endpoint, { id: `${id}_test`, type: TEST_EVENT_TYPE, attempt: 1 }, body);
}

export const productionEmitDeps: EmitDeps = {
  loadEndpoints: listTenantEndpoints,
  hasAccess: hasApiAccess,
  // Overridden at call sites with Next's `after`, which only exists inside
  // a request; this fallback runs the task without awaiting it.
  defer: (task) => {
    void task().catch((error) => console.error("[webhooks] deferred task failed:", error));
  },
};

/* ------------------------------------------------ helpers */

function rotating(
  e: Pick<WebhookEndpoint, "previousSecretCiphertext" | "previousSecretExpiresAt">,
  nowMs: number
): boolean {
  return Boolean(e.previousSecretCiphertext && e.previousSecretExpiresAt && e.previousSecretExpiresAt.getTime() > nowMs);
}

export function endpointFromData(id: string, tenantId: string, d: FirebaseFirestore.DocumentData): WebhookEndpoint {
  return {
    id,
    tenantId,
    url: d.url ?? "",
    description: d.description ?? "",
    events: Array.isArray(d.events) ? d.events : [],
    secretCiphertext: d.secretCiphertext ?? "",
    secretKeyVersion: d.secretKeyVersion ?? 1,
    previousSecretCiphertext: d.previousSecretCiphertext ?? null,
    previousSecretKeyVersion: d.previousSecretKeyVersion ?? null,
    previousSecretExpiresAt: toDate(d.previousSecretExpiresAt),
    active: d.active === true,
    disabledReason: d.disabledReason ?? null,
    failingSince: toDate(d.failingSince),
    createdAt: toDate(d.createdAt),
  };
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate(): Date }).toDate();
  }
  return null;
}

/**
 * `after()` exists only inside a request. Fulfilment always runs inside one
 * (verify, the Paystack webhook, the cron route, the superadmin page), but a
 * script or test calling it must not crash on it: then the task just runs.
 */
function deferSafely(task: () => Promise<void>): void {
  const run = () => task().catch((error) => console.error("[webhooks] deferred task failed:", error));
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * The events for a voucher that was just written: `voucher.issued`,
 * `voucher.renewed` or `voucher.failed`, plus `payment.succeeded` when there
 * is a payment. Built from the stored documents through the public
 * serializers, so a webhook's voucher is exactly the API's.
 *
 * Never throws into a sale: returns false on any failure, so the caller can
 * leave its "emitted" flag unset and a resume tries again.
 */
export async function emitVoucherEvents(args: {
  tenantId: string;
  voucherId: string;
  type: "voucher.issued" | "voucher.renewed" | "voucher.failed";
  paymentDocId: string | null;
}): Promise<boolean> {
  try {
    // The cheap check first: no endpoint, no reads, no writes.
    const endpoints = await listTenantEndpoints(args.tenantId);
    if (!endpoints.some((e) => e.active)) return true;

    const deps: EmitDeps = { ...productionEmitDeps, defer: deferSafely };
    const voucherSnap = await adminDb.collection(TENANT_COLLECTIONS.vouchers(args.tenantId)).doc(args.voucherId).get();
    const voucher = parseVoucher(voucherSnap);
    if (!voucher) return true;
    await emitWebhookEvent(
      { tenantId: args.tenantId, type: args.type, subjectId: voucher.id, data: { voucher: publicVoucher(voucher) } },
      deps
    );

    if (args.paymentDocId) {
      const payment = parsePayment(
        await adminDb.collection(TENANT_COLLECTIONS.payments(args.tenantId)).doc(args.paymentDocId).get()
      );
      if (payment) {
        await emitWebhookEvent(
          {
            tenantId: args.tenantId,
            type: "payment.succeeded",
            subjectId: payment.paystackReference,
            data: { payment: publicPayment(payment) },
          },
          deps
        );
      }
    }
    return true;
  } catch (error) {
    console.error(`[webhooks] could not emit events for voucher ${args.voucherId}:`, error);
    return false;
  }
}

