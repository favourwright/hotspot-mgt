import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import {
  verifyOwnerWithTenant,
  handleAuthError,
} from "@/lib/auth-helpers";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";

const updateRouterSchema = z.object({
  name: z.string().min(2).optional(),
  routerUser: z.string().min(1).optional(),
  routerPass: z.string().min(1).optional(),
  active: z.boolean().optional(),
  status: z.enum(["pending", "online", "offline"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const { id } = await params;
    const body = await request.json();
    const validation = updateRouterSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const routerRef = adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(id);

    const routerDoc = await routerRef.get();
    if (!routerDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    await routerRef.update({
      ...validation.data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const { id } = await params;

    // Check if any locations reference this router
    const locationsSnapshot = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .where("routerId", "==", id)
      .limit(1)
      .get();

    if (!locationsSnapshot.empty) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Cannot delete router with active locations. Delete locations first.",
        },
        { status: 400 }
      );
    }

    const routerRef = adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(id);

    await routerRef.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
