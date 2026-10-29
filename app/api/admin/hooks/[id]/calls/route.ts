/** The hook's recent calls, newest first, for the owner's call log. */

import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { listHookCalls } from "@/lib/decision-hooks";
import { badRequest, hookErrorResponse, loadOwnedHook } from "@/lib/decision-hook-admin";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const owner = await verifyOwnerWithTenant(request.headers.get("authorization"));
    // The log is keyed by hook id alone, so ownership is checked here.
    const hook = await loadOwnedHook(owner.tenantId, id);
    if (!hook) return badRequest("Hook not found", 404);
    return NextResponse.json({ success: true, data: await listHookCalls(id, 50) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
