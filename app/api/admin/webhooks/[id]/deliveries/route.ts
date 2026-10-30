/** The endpoint's recent deliveries, newest first. */

import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { listEndpointDeliveries } from "@/lib/webhooks";
import { loadOwnedEndpoint } from "@/lib/webhook-admin";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const owner = await verifyOwnerWithTenant(request.headers.get("authorization"));
    // Keyed by endpoint id alone, so ownership is checked here.
    if (!(await loadOwnedEndpoint(owner.tenantId, id))) return badRequest("Endpoint not found", 404);
    return NextResponse.json({ success: true, data: await listEndpointDeliveries(id, 50) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
