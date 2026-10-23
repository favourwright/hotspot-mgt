import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { getActiveSessions, removeActiveSession } from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";

/**
 * Disconnects one device from the hotspot.
 *
 * POST rather than `DELETE /active-sessions/[sessionId]` because a RouterOS
 * id looks like `*1A`, and carrying that through a path segment buys
 * nothing over a body.
 *
 * The re-read before the remove is the point of this route. The client
 * clicks a row from a list polled every 15s, and RouterOS hands a finished
 * session's `.id` back out to a new one, so acting on the id alone can
 * disconnect a customer nobody chose. The username the operator was shown
 * has to still match the id before anything is removed.
 *
 * Unlike the GET beside it, an unreachable router is an error here: this is
 * an action someone is waiting on, not a view that can degrade.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const { id: locationId } = await params;

    const body = await request.json().catch(() => null);
    const sessionId = typeof body?.id === "string" ? body.id : null;
    const username = typeof body?.user === "string" ? body.user : null;

    if (!sessionId || !username) {
      return NextResponse.json(
        { success: false, error: "A session id and username are required" },
        { status: 400 }
      );
    }

    const resolved = await getRouterForLocation(tenantId, locationId);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    const current = await getActiveSessions(resolved.config);
    if (!current.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Couldn't reach ${resolved.routerName}: ${current.error ?? "unknown error"}`,
        },
        { status: 502 }
      );
    }

    const match = (current.data ?? []).find(
      (session) => session[".id"] === sessionId && session.user === username
    );

    // 409, not 404: the session ending on its own is not a failed request,
    // and the client says "already disconnected" rather than showing an
    // error for something that reached the state the operator wanted.
    if (!match) {
      return NextResponse.json(
        {
          success: false,
          error: `${username} is no longer connected in that session`,
        },
        { status: 409 }
      );
    }

    const removed = await removeActiveSession(resolved.config, sessionId);
    if (!removed.success) {
      return NextResponse.json(
        { success: false, error: removed.error ?? "Unknown error" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { id: sessionId, user: username },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
