import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { LOCATIONS_COLLECTION, PLANS_COLLECTION, USERS_COLLECTION } from "@/lib/firebase-collections";
import { pushProfileLoginScript } from "@/lib/mikrotik";

async function verifyAdmin(token: string) {
  const decodedToken = await adminAuth.verifyIdToken(token);
  const userDoc = await adminDb
    .collection(USERS_COLLECTION)
    .doc(decodedToken.uid)
    .get();

  if (!userDoc.exists || userDoc.data()?.role !== "admin") {
    throw new Error("Unauthorized: Admin access required");
  }

  return decodedToken;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];
    await verifyAdmin(token);

    const { id: planId } = await params;

    // Fetch plan document
    const planDoc = await adminDb
      .collection(PLANS_COLLECTION)
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

    // Fetch location with router credentials
    const locationDoc = await adminDb
      .collection(LOCATIONS_COLLECTION)
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

    const routerConfig = {
      ip: locationData.routerIp,
      username: locationData.routerUser,
      password: locationData.routerPass,
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
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
