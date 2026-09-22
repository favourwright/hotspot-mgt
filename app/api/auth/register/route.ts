import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { USERS_COLLECTION } from "@/lib/firebase-collections";
import { z } from "zod";

const registerSchema = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
});

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

    // Parse and validate request body
    const body = await request.json();
    const validationResult = registerSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request data" },
        { status: 400 }
      );
    }

    const { uid, email } = validationResult.data;

    // Verify the uid matches the token
    if (uid !== decodedToken.uid) {
      return NextResponse.json(
        { success: false, error: "UID mismatch" },
        { status: 403 }
      );
    }

    // Determine role based on ADMIN_EMAIL env var
    const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
    const userEmail = email.toLowerCase().trim();
    const role = userEmail === adminEmail ? "admin" : "customer";

    console.log("Admin email check:", { adminEmail, userEmail, role }); // Debug log

    // Create user document in Firestore
    await adminDb.collection(USERS_COLLECTION).doc(uid).set({
      uid,
      email,
      role,
      createdAt: new Date(),
    });

    return NextResponse.json({
      success: true,
      data: { role },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
