import { NextRequest, NextResponse } from "next/server";
import {
  verifyOwnerWithTenant,
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getTenantStats } from "@/lib/firestore-helpers";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const verifiedUser = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const stats = await getTenantStats(verifiedUser.tenantId);

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
