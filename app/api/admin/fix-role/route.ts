import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { USERS_COLLECTION } from "@/lib/firebase-collections";

/**
 * Emergency endpoint to fix admin role
 * DELETE THIS FILE after fixing your admin account
 */
export async function POST(request: NextRequest) {
  try {
    // Get auth token from header
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];

    // Verify the Firebase token
    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
    const userEmail = decodedToken.email?.toLowerCase().trim();

    console.log("Fix role request:", { adminEmail, userEmail });

    if (userEmail !== adminEmail) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Email ${userEmail} does not match ADMIN_EMAIL ${adminEmail}` 
        },
        { status: 403 }
      );
    }

    // Update role to admin
    await adminDb.collection(USERS_COLLECTION).doc(decodedToken.uid).update({
      role: "admin",
    });

    return NextResponse.json({
      success: true,
      data: { 
        message: "Role updated to admin",
        uid: decodedToken.uid,
        email: userEmail 
      },
    });
  } catch (error) {
    console.error("Fix role error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
