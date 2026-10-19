import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateRouterCache } from "@/lib/router-config";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { z } from "zod";

const updateLocationSchema = z.object({
  name: z.string().min(2).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await requireUnlockedOwner(authHeader);
    const { tenantId } = verifiedUser;

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
    const locationRef = adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).doc(id);
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

    // The location may now point at a different router.
    invalidateRouterCache(tenantId, id);

    const updatedDoc = await locationRef.get();
    const updatedData = updatedDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: updatedDoc.id,
        name: updatedData?.name || '',
        routerId: updatedData?.routerId || '',
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
    const verifiedUser = await requireUnlockedOwner(authHeader);
    const { tenantId } = verifiedUser;

    // Check if location exists
    const locationRef = adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).doc(id);
    const locationDoc = await locationRef.get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    await locationRef.delete();
    invalidateRouterCache(tenantId, id);

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
