/** Send a delivery again now, with a fresh retry schedule. */

import { NextRequest, NextResponse } from "next/server";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { rateLimit } from "@/lib/rate-limit";
import { redeliver } from "@/lib/webhooks";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ deliveryId: string }> }) {
  try {
    const { deliveryId } = await params;
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);
    if (!rateLimit(`redeliver:${owner.tenantId}`, { max: 20, windowMs: 60_000 }).ok) {
      return badRequest("Too many attempts. Wait a minute and try again.", 429);
    }
    // Checks the delivery belongs to this tenant before touching it.
    const result = await redeliver(owner.tenantId, deliveryId);
    if (!result) return badRequest("Delivery not found", 404);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
