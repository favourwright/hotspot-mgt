import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { PLANS_COLLECTION, USERS_COLLECTION } from "@/lib/firebase-collections";
import { z } from "zod";

const updatePlanSchema = z.object({
  name: z.string().min(2, "Plan name must be at least 2 characters").optional(),
  price: z.number().min(1, "Price must be greater than 0").optional(),
  duration: z.string().min(1, "Duration is required").optional(),
  routerDuration: z.string().min(1, "Router duration is required").optional(),
  dataLimit: z.string().min(1, "Data limit is required").optional(),
  mikrotikProfile: z.string().min(1, "MikroTik profile is required").optional(),
  active: z.boolean().optional(),
  sameCredentials: z.boolean().optional(),
});

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

export async function PATCH(
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

    const body = await request.json();
    const validationResult = updatePlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const updateData = validationResult.data;

    // Check if plan exists
    const planRef = adminDb.collection(PLANS_COLLECTION).doc(planId);
    const planDoc = await planRef.get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Update plan document
    await planRef.update({
      ...updateData,
      updatedAt: new Date(),
    });

    const updatedDoc = await planRef.get();
    const data = updatedDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: planRef.id,
        ...data,
        createdAt: data?.createdAt?.toDate?.()?.toISOString(),
        updatedAt: data?.updatedAt?.toDate?.()?.toISOString(),
      },
    });
  } catch (error) {
    console.error("PATCH plan error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function DELETE(
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

    const planRef = adminDb.collection(PLANS_COLLECTION).doc(planId);
    const planDoc = await planRef.get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    await planRef.delete();

    return NextResponse.json({
      success: true,
      data: { id: planId },
    });
  } catch (error) {
    console.error("DELETE plan error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Unauthorized") ? 403 : 500;
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
