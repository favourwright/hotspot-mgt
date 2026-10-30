/**
 * Revoke a key. Needs neither the addon nor an unlocked account: an owner
 * must always be able to kill a key that has leaked. Effective on the
 * key's very next request (lib/api-keys.ts invalidates its cache).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { revokeApiKey } from "@/lib/api-keys";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const owner = await verifyOwnerWithTenant(request.headers.get("authorization"));
    if (!(await revokeApiKey(owner.tenantId, id))) return badRequest("Key not found", 404);
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
