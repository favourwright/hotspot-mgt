import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { USERS_COLLECTION } from "@/lib/firebase-collections";
import { testRouterConnection } from "@/lib/mikrotik";
import { z } from "zod";

const testConnectionSchema = z.object({
  routerIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"),
  routerUser: z.string().min(1, "Router username is required"),
  routerPass: z.string().min(1, "Router password is required"),
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

    // Verify admin
    const decodedToken = await adminAuth.verifyIdToken(token);
    const userDoc = await adminDb
      .collection(USERS_COLLECTION)
      .doc(decodedToken.uid)
      .get();

    if (!userDoc.exists || userDoc.data()?.role !== "admin") {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Admin access required" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validationResult = testConnectionSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { routerIp, routerUser, routerPass } = validationResult.data;

    // Test connection
    const result = await testRouterConnection({
      ip: routerIp,
      username: routerUser,
      password: routerPass,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Test connection error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
