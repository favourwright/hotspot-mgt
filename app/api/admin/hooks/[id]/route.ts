/**
 * Edit or delete the owner's hook.
 *
 * Switching a hook off and deleting it need neither API access nor an
 * unlocked account, on purpose: an owner whose plan no longer includes API
 * access, or whose plan fee is overdue, must always be able to stop a block hook that is pausing
 * their own sales. Every other change needs both.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { assertHookUrl, checkHookHostResolves } from "@/lib/safe-fetch";
import {
  breaker,
  hookView,
  invalidateTenantHooks,
  listTenantHooks,
} from "@/lib/decision-hooks";
import {
  badRequest,
  hookErrorResponse,
  hookRef,
  loadOwnedHook,
  normaliseIds,
  updateHookSchema,
} from "@/lib/decision-hook-admin";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const authHeader = request.headers.get("authorization");

    const validation = updateHookSchema.safeParse(await request.json());
    if (!validation.success) return badRequest(validation.error.issues[0].message);
    const input = validation.data;

    const onlySwitchingOff =
      input.active === false && Object.keys(input).every((k) => k === "active");

    const owner = onlySwitchingOff
      ? await verifyOwnerWithTenant(authHeader)
      : await requireUnlockedOwner(authHeader);
    if (!onlySwitchingOff) await requireApiAccess(owner.tenantId);

    const hook = await loadOwnedHook(owner.tenantId, id);
    if (!hook) return badRequest("Hook not found", 404);

    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (input.name !== undefined) update.name = input.name;
    if (input.url !== undefined) {
      const url = assertHookUrl(input.url).toString();
      await checkHookHostResolves(url);
      update.url = url;
    }
    if (input.timeoutMs !== undefined) update.timeoutMs = input.timeoutMs;
    if (input.failStrategy !== undefined) update.failStrategy = input.failStrategy;
    if (input.planIds !== undefined) update.planIds = normaliseIds(input.planIds);
    if (input.locationIds !== undefined) update.locationIds = normaliseIds(input.locationIds);
    if (input.active !== undefined) update.active = input.active;

    await hookRef(owner.tenantId, id).update(update);
    // A changed or re-enabled hook gets a clean start rather than inheriting
    // failures from the URL it used to have.
    breaker.reset(id);
    invalidateTenantHooks(owner.tenantId);

    const updated = (await listTenantHooks(owner.tenantId)).find((h) => h.id === id);
    return NextResponse.json({ success: true, data: updated ? hookView(updated) : null });
  } catch (error) {
    return hookErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const owner = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const hook = await loadOwnedHook(owner.tenantId, id);
    if (!hook) return badRequest("Hook not found", 404);

    await hookRef(owner.tenantId, id).delete();
    breaker.reset(id);
    invalidateTenantHooks(owner.tenantId);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
