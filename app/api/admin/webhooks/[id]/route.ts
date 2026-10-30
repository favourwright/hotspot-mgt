/**
 * Edit or delete an endpoint. Switching one off and deleting need neither
 * the addon nor an unlocked account; switching on and editing need both.
 * Switching back on clears the failing clock, so a fixed server starts clean.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { assertHookUrl, checkHookHostResolves } from "@/lib/safe-fetch";
import { endpointRef, endpointView, invalidateTenantEndpoints, listTenantEndpoints } from "@/lib/webhooks";
import { loadOwnedEndpoint, updateEndpointSchema } from "@/lib/webhook-admin";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get("authorization");
    const validation = updateEndpointSchema.safeParse(await request.json());
    if (!validation.success) return badRequest(validation.error.issues[0].message);
    const input = validation.data;

    const onlySwitchingOff = input.active === false && Object.keys(input).every((k) => k === "active");
    const owner = onlySwitchingOff ? await verifyOwnerWithTenant(authHeader) : await requireUnlockedOwner(authHeader);
    if (!onlySwitchingOff) await requireApiAccess(owner.tenantId);

    if (!(await loadOwnedEndpoint(owner.tenantId, id))) return badRequest("Endpoint not found", 404);

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.url !== undefined) {
      const url = assertHookUrl(input.url).toString();
      await checkHookHostResolves(url);
      update.url = url;
    }
    if (input.description !== undefined) update.description = input.description;
    if (input.events !== undefined) update.events = [...new Set(input.events)];
    if (input.active !== undefined) {
      update.active = input.active;
      if (input.active) {
        update.failingSince = null;
        update.disabledReason = null;
      }
    }

    await endpointRef(owner.tenantId, id).update(update);
    invalidateTenantEndpoints(owner.tenantId);
    const updated = (await listTenantEndpoints(owner.tenantId)).find((e) => e.id === id);
    return NextResponse.json({ success: true, data: updated ? endpointView(updated) : null });
  } catch (error) {
    return hookErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const owner = await verifyOwnerWithTenant(request.headers.get("authorization"));
    if (!(await loadOwnedEndpoint(owner.tenantId, id))) return badRequest("Endpoint not found", 404);
    await endpointRef(owner.tenantId, id).delete();
    invalidateTenantEndpoints(owner.tenantId);
    // Its pending deliveries cancel themselves on their next attempt.
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
