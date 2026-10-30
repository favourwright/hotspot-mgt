/** What the owner's webhook routes share: validation and ownership lookup. */

import { z } from "zod";
import { WEBHOOK_EVENT_TYPES } from "@/lib/webhook-events";
import { endpointFromData, endpointRef, type WebhookEndpoint } from "@/lib/webhooks";

const events = z.array(z.enum(WEBHOOK_EVENT_TYPES as [string, ...string[]])).max(20);

export const createEndpointSchema = z.object({
  url: z.string().trim().min(1, "Enter your server's URL"),
  description: z.string().trim().max(120).default(""),
  /** Empty means every event. */
  events: events.default([]),
});

export const updateEndpointSchema = z.object({
  url: z.string().trim().min(1).optional(),
  description: z.string().trim().max(120).optional(),
  events: events.optional(),
  active: z.boolean().optional(),
});

export async function loadOwnedEndpoint(tenantId: string, id: string): Promise<WebhookEndpoint | null> {
  const snap = await endpointRef(tenantId, id).get();
  return snap.exists ? endpointFromData(snap.id, tenantId, snap.data()!) : null;
}
