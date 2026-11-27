import { NextRequest, NextResponse } from "next/server";
import {
  verifyOwnerWithTenant,
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getCachedTenantStats } from "@/lib/stats-cache";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const verifiedUser = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    // Cached, like the page: the client refetches this on window focus, and
    // uncached that was a full recompute every time an owner tabbed back.
    // Whatever changes the figures clears the cache first (lib/stats-cache.ts).
    const stats = await getCachedTenantStats(verifiedUser.tenantId);

    return NextResponse.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Stats fetch error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
