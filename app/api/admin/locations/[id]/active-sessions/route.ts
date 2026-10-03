import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { getActiveSessions } from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";

/**
 * Who is connected right now. This is the one endpoint the UI polls, so it
 * is deliberately thin: no Firestore reads (the router config is cached in
 * lib/router-config.ts) and a bounded router call.
 *
 * An unreachable router is a 200 with reachable:false, not an error - the
 * client shows "couldn't reach the router" and backs off, rather than
 * treating it as a broken page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);
    const { id: locationId } = await params;

    const resolved = await getRouterForLocation(tenantId, locationId);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    const result = await getActiveSessions(resolved.config);

    return NextResponse.json({
      success: true,
      data: {
        sessions: result.success ? result.data ?? [] : [],
        reachable: result.success,
        error: result.success ? null : result.error ?? "Unknown error",
        routerName: resolved.routerName,
        locationName: resolved.locationName,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
