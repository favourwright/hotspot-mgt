/** Send test event: a real, signed `webhook.test`, not stored or retried. */

import { NextRequest, NextResponse } from "next/server";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { rateLimit } from "@/lib/rate-limit";
import { sendTestEvent } from "@/lib/webhooks";
import { loadOwnedEndpoint } from "@/lib/webhook-admin";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);
    // The easiest place to probe a URL guard from, so it is the tightest.
    if (!rateLimit(`webhooktest:${owner.tenantId}`, { max: 5, windowMs: 60_000 }).ok) {
      return badRequest("Too many tests. Wait a minute and try again.", 429);
    }
    const endpoint = await loadOwnedEndpoint(owner.tenantId, id);
    if (!endpoint) return badRequest("Endpoint not found", 404);
    return NextResponse.json({ success: true, data: await sendTestEvent(endpoint) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
