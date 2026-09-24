import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  LOCATIONS_COLLECTION,
  PLANS_COLLECTION,
  USERS_COLLECTION,
} from "@/lib/firebase-collections";
import { setupLocationExpirySystem } from "@/lib/mikrotik";
import type { RouterConfig } from "@/lib/mikrotik";

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

    // Fetch location document
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
        { success: false, error: "Location data is invalid" },
        { status: 500 }
      );
    }

    // Build router config
    const routerConfig: RouterConfig = {
      ip: locationData.routerIp,
      username: locationData.routerUser,
      password: locationData.routerPass,
    };

    // Fetch all active plans for this location
    const plansSnapshot = await adminDb
      .collection(PLANS_COLLECTION)
      .where("locationId", "==", locationId)
      .where("active", "==", true)
      .get();

    // Build profileDurationMap
    const profileDurationMap: Record<string, string> = {};
    plansSnapshot.docs.forEach((doc) => {
      const plan = doc.data();
      if (plan.mikrotikProfile && plan.routerDuration) {
        profileDurationMap[plan.mikrotikProfile] = plan.routerDuration;
      }
    });

    // Warn if no plans found
    if (Object.keys(profileDurationMap).length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          loginScript: false,
          expiryScript: false,
          scheduler: false,
        },
        warning: "No active plans found. Scripts and scheduler were not configured. Please add plans and re-run setup.",
      });
    }

    // Setup expiry system
    const result = await setupLocationExpirySystem(
      routerConfig,
      profileDurationMap
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("POST setup-expiry error:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
