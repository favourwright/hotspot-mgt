/**
 * Outbound webhook events: what they are, what they carry, and the rules
 * for delivering them. Pure, so `npm run test:webhooks` covers every rule;
 * lib/webhooks.ts does the I/O.
 *
 * Informational, unlike decision hooks: an event says something already
 * happened, and nothing waits on the tenant's answer. So delivery is
 * at-least-once with retries, and the tenant dedupes on `id`.
 *
 * Payloads are built from the same public schemas the API returns
 * (lib/api-schemas.ts), so a voucher in a webhook is exactly a voucher from
 * GET /api/v1/vouchers/{id}, and the docs generated from those schemas
 * describe both.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { PublicPaymentSchema, PublicVoucherSchema } from "@/lib/api-schemas";

export const WEBHOOK_API_VERSION = "2026-10-30";

export const WEBHOOK_EVENTS = {
  "voucher.issued": {
    description: "A voucher was created and is ready to use: a first purchase, or a failed one fixed later.",
    data: z.object({ voucher: PublicVoucherSchema }),
  },
  "voucher.renewed": {
    description: "A customer topped up a login they already had. `voucher.renewalOf` names the one it took over from.",
    data: z.object({ voucher: PublicVoucherSchema }),
  },
  "voucher.failed": {
    description: "A customer paid but the router could not be programmed. The voucher waits in the Failed Queue for a retry.",
    data: z.object({ voucher: PublicVoucherSchema }),
  },
  "payment.succeeded": {
    description: "A customer's payment was recorded against a voucher.",
    data: z.object({ payment: PublicPaymentSchema }),
  },
} as const;

export type WebhookEventType = keyof typeof WEBHOOK_EVENTS;
export const WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENTS) as WebhookEventType[];

/** Sent only by the owner's "Send test event" button. */
export const TEST_EVENT_TYPE = "webhook.test";

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as string[]).includes(value);
}

/**
 * One id per fact, the same however many times it is reported. Fulfilment
 * can run from the browser, Knomad Pay's event and the reconcile cron for
 * the same sale; all three produce `voucher.issued` for voucher V, and all
 * three must produce the same event. Deterministic, so the event document
 * is created once and the tenant sees one event.
 */
export function webhookEventId(type: string, subjectId: string): string {
  return `evt_${createHash("sha256").update(`${type}:${subjectId}`).digest("hex").slice(0, 32)}`;
}

/** The body we POST, stringified once and signed as sent. */
export function webhookBody(event: {
  id: string;
  type: string;
  createdAt: Date;
  data: unknown;
}): string {
  return JSON.stringify({
    apiVersion: WEBHOOK_API_VERSION,
    id: event.id,
    type: event.type,
    createdAt: event.createdAt.toISOString(),
    data: event.data,
  });
}

/**
 * When to try again after `attempt` failed attempts: quickly at first, then
 * spread over about a day. Null means give up.
 */
export const RETRY_DELAYS_MS = [
  60_000, //          1 min
  5 * 60_000, //      5 min
  30 * 60_000, //    30 min
  2 * 3600_000, //    2 h
  6 * 3600_000, //    6 h
  12 * 3600_000, //  12 h
  24 * 3600_000, //  24 h
];
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

export function nextAttemptDelayMs(attemptsSoFar: number): number | null {
  return attemptsSoFar >= 1 && attemptsSoFar <= RETRY_DELAYS_MS.length
    ? RETRY_DELAYS_MS[attemptsSoFar - 1]
    : null;
}

/**
 * An endpoint that has not accepted anything for this long is switched
 * off and its owner emailed. Unlike a decision hook, switching a webhook
 * off loses nothing that matters at the moment of sale: the data is still
 * in the API. Three days covers a long weekend.
 */
export const DISABLE_AFTER_FAILING_MS = 3 * 24 * 3600_000;

export function shouldDisableEndpoint(failingSince: Date | null, now: Date): boolean {
  return failingSince !== null && now.getTime() - failingSince.getTime() >= DISABLE_AFTER_FAILING_MS;
}

/** Whether an endpoint wants this event. An empty list means all of them. */
export function endpointWants(events: readonly string[], type: string): boolean {
  return events.length === 0 || events.includes(type) || type === TEST_EVENT_TYPE;
}
