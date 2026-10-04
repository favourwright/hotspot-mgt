import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getHotspotCounts } from "@/lib/hotspot-counts";

// Totals for the dashboard tiles. Separate from the Users page endpoints on
// purpose: those return rows, this returns four numbers, so the router is
// asked for ids only and the result is cached for everyone.
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);

    return NextResponse.json({
      success: true,
      data: await getHotspotCounts(tenantId),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
