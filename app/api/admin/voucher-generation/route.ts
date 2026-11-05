/**
 * The Generate codes page's settings: what the owner has left to generate,
 * how their codes look, and whether the addon is on. PATCH changes the code
 * format, which only shapes batches generated afterwards.
 *
 * Reading is never gated, so a tenant whose addon lapsed can still see and
 * export what they already printed. See docs/voucher-generation.md.
 */

import { NextRequest, NextResponse } from "next/server";

import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { VOUCHER_GENERATION_ADDON } from "@/lib/addon-catalog";
import { hasAddon } from "@/lib/entitlements";
import { getPlatformConfig } from "@/lib/platform-config";
import { getCodeFormat, getGenerationQuota, setCodeFormat } from "@/lib/voucher-generation";
import { generationErrorResponse } from "@/lib/voucher-generation-http";
import { GeneratedCodeFormatSchema } from "@/types/schemas";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const [quota, format, entitled, config] = await Promise.all([
      getGenerationQuota(tenantId),
      getCodeFormat(tenantId),
      hasAddon(tenantId, VOUCHER_GENERATION_ADDON),
      getPlatformConfig(),
    ]);
    return NextResponse.json({
      success: true,
      data: { quota, format, entitled, limits: config.voucherGeneration },
    });
  } catch (error) {
    return generationErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await requireUnlockedOwner(request.headers.get("authorization"));
    const parsed = GeneratedCodeFormatSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    await setCodeFormat(tenantId, parsed.data);
    return NextResponse.json({ success: true, data: parsed.data });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
