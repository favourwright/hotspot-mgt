import { routerLogin } from "@/lib/router-credentials";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { testRouterConnection } from "@/lib/mikrotik";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await requireUnlockedOwner(authHeader);
    const { tenantId } = verifiedUser;

    const { id: locationId } = await params;

    // Fetch location
    const locationDoc = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(locationId)
      .get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const locationData = locationDoc.data();
    if (!locationData) {
      return NextResponse.json(
        { success: false, error: "Location data not found" },
        { status: 404 }
      );
    }

    // Fetch router credentials via location's routerId
    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(locationData.routerId)
      .get();

    if (!routerDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    const routerData = routerDoc.data();
    if (!routerData) {
      return NextResponse.json(
        { success: false, error: "Router data not found" },
        { status: 404 }
      );
    }

    const routerConfig = {
      ip: routerData.routerIp,
      ...routerLogin(routerData),
    };

    // Test router connection
    const connectionResult = await testRouterConnection(routerConfig);
    if (!connectionResult.success) {
      return NextResponse.json(
        { success: false, error: `Router connection failed: ${connectionResult.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { message: "Router connection verified" },
    });
  } catch (error) {
    console.error("POST setup-expiry-system error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
