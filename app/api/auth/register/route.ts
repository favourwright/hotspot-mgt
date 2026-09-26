import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";

const registerSchema = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];

    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = registerSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request data" },
        { status: 400 }
      );
    }

    const { uid, email } = validationResult.data;

    if (uid !== decodedToken.uid) {
      return NextResponse.json(
        { success: false, error: "UID mismatch" },
        { status: 403 }
      );
    }

    // Check if user document already exists
    const existingUser = await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(uid)
      .get();

    if (existingUser.exists) {
      const existingData = existingUser.data();
      return NextResponse.json({
        success: true,
        data: {
          role: existingData?.role,
          tenantId: existingData?.tenantId || null,
        },
      });
    }

    // Determine role
    const superadminEmail = (
      process.env.SUPERADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ""
    )
      .toLowerCase()
      .trim();
    const userEmail = email.toLowerCase().trim();

    let role: "superadmin" | "owner" | "customer" = "customer";
    if (userEmail === superadminEmail) {
      role = "superadmin";
    }

    // Create user document
    await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(uid)
      .set({
        uid,
        email,
        role,
        tenantId: null,
        createdAt: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({
      success: true,
      data: { role, tenantId: null },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
