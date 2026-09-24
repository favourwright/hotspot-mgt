import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { LOCATIONS_COLLECTION, USERS_COLLECTION } from "@/lib/firebase-collections";
import { pushExpiryCheckerScript, pushExpiryScheduler } from "@/lib/mikrotik";

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

    const { id: locationId } = await params;

    // Fetch location with router credentials
    const locationDoc = await adminDb
      .collection(LOCATIONS_COLLECTION)
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

    const routerConfig = {
      ip: locationData.routerIp,
      username: locationData.routerUser,
      password: locationData.routerPass,
    };

    // Push expiry checker script
    const checkerResult = await pushExpiryCheckerScript(routerConfig);
    if (!checkerResult.success) {
      return NextResponse.json(
        { success: false, error: `Failed to push expiry checker script: ${checkerResult.error}` },
        { status: 500 }
      );
    }

    // Push expiry scheduler
    const schedulerResult = await pushExpiryScheduler(routerConfig);
    if (!schedulerResult.success) {
      return NextResponse.json(
        { success: false, error: `Failed to push expiry scheduler: ${schedulerResult.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { message: "Expiry system configured on router" },
    });
  } catch (error) {
    console.error("POST setup-expiry-system error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
