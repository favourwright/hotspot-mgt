import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getHotspotUserDetail } from "@/lib/hotspot-user-detail";

// One user's full detail, fetched when the dialog opens rather than being
// carried in the list response — it includes the password.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; username: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);

    const { id: locationId, username } = await params;
    const detail = await getHotspotUserDetail(
      tenantId,
      locationId,
      decodeURIComponent(username)
    );

    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
