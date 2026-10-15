import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { z } from "zod";

const updatePlanSchema = z.object({
  name: z.string().min(2, "Plan name must be at least 2 characters").optional(),
  price: z.number().min(1, "Price must be greater than 0").optional(),
  duration: z.string().min(1, "Duration is required").optional(),
  routerDurationValue: z.number().int().min(1, "Router duration value is required").optional(),
  routerDurationUnit: z.enum(["h", "d"], { message: "Router duration unit must be 'h' or 'd'" }).optional(),
  dataLimit: z.string().min(1, "Data limit is required").optional(),
  sharedUsers: z.string().nullable().optional(),
  mikrotikProfile: z.string().min(1, "MikroTik profile is required").optional(),
  active: z.boolean().optional(),
  sameCredentials: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

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
    const planRef = adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(planId);
    const planDoc = await planRef.get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    // Update plan document
    // `update()` rejects an undefined value, so a key Zod left out must be
    // dropped rather than spread through as undefined.
    const sanitised = Object.fromEntries(
      Object.entries(updateData).filter(([, value]) => value !== undefined)
    );

    await planRef.update({
      ...sanitised,
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
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    const { id: planId } = await params;

    const planRef = adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).doc(planId);
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
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
