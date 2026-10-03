import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getMergedHotspotUsers } from "@/lib/hotspot-users";

// Platform vouchers joined with the router's own hotspot users. Returns 200
// with routerReachable:false when the router can't be reached, rather than
// an error - the platform half is still worth showing.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const { id: locationId } = await params;

    const result = await getMergedHotspotUsers(tenantId, locationId);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
