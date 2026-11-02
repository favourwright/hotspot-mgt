import { routerLogin } from "@/lib/router-credentials";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { pushProfileLoginScript } from "@/lib/mikrotik";
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

    const { id: planId } = await params;

    // Fetch plan document
    const planDoc = await adminDb
      .collection(TENANT_COLLECTIONS.plans(tenantId))
      .doc(planId)
      .get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    const planData = planDoc.data();
    if (!planData) {
      return NextResponse.json(
        { success: false, error: "Plan data not found" },
        { status: 404 }
      );
    }

    // Fetch location
    const locationDoc = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(planData.locationId)
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

    // Push on-login script to the profile
    const result = await pushProfileLoginScript(
      routerConfig,
      planData.mikrotikProfile,
      planData.routerDurationValue,
      planData.routerDurationUnit
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST push-login-script error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
