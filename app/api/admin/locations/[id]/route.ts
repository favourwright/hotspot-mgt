import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { LOCATIONS_COLLECTION } from "@/lib/firebase-collections";
import { verifyOwner, handleAuthError } from "@/lib/auth-helpers";
import { z } from "zod";

const updateLocationSchema = z.object({
  name: z.string().min(2).optional(),
  routerIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/).optional(),
  routerUser: z.string().min(1).optional(),
  routerPass: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const authHeader = request.headers.get("authorization");
    await verifyOwner(authHeader);

    const body = await request.json();
    const validationResult = updateLocationSchema.safeParse(body);

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

    // Check if location exists
    const locationRef = adminDb.collection(LOCATIONS_COLLECTION).doc(id);
    const locationDoc = await locationRef.get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    // Update location
    await locationRef.update({
      ...updateData,
      updatedAt: new Date(),
    });

    const updatedDoc = await locationRef.get();
    const updatedData = updatedDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: updatedDoc.id,
        name: updatedData?.name || '',
        routerIp: updatedData?.routerIp || '',
        active: updatedData?.active ?? false,
        updatedAt: updatedData?.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("PATCH location error:", error);
    const { message, status } = handleAuthError(error);
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
    const { id } = await params;
    
    const authHeader = request.headers.get("authorization");
    await verifyOwner(authHeader);

    // Check if location exists
    const locationRef = adminDb.collection(LOCATIONS_COLLECTION).doc(id);
    const locationDoc = await locationRef.get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    await locationRef.delete();

    return NextResponse.json({
      success: true,
      data: { id },
    });
  } catch (error) {
    console.error("DELETE location error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
