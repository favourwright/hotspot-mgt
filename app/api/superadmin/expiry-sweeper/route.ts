/**
 * Rolls routers onto the current expiry sweeper and removes the legacy
 * global checker. Superadmin only. One tenant per POST; see
 * lib/expiry-sweeper-rollout.ts for why.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { handleAuthError, verifySuperAdmin } from "@/lib/auth-helpers";
import {
  rolloutExpirySweeper,
  tenantsWithRouters,
} from "@/lib/expiry-sweeper-rollout";

const bodySchema = z.object({
  tenantId: z.string().min(1),
  apply: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: await tenantsWithRouters() });
  } catch (error) {
    console.error("List expiry sweeper tenants error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const report = await rolloutExpirySweeper(parsed.data.tenantId, {
      apply: parsed.data.apply,
    });
    return NextResponse.json({ success: true, data: report });
  } catch (error) {
    console.error("Expiry sweeper rollout error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
