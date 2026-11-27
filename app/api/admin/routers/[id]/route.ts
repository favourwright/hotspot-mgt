import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import {
  handleAuthError,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateRouterCache } from "@/lib/router-config";
import { invalidateTenantFleet } from "@/lib/tenant-fleet";
import { FieldValue } from "firebase-admin/firestore";
import { routerPasswordUpdateFields } from "@/lib/router-credentials";

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
    const { tenantId } = await requireUnlockedOwner(authHeader);

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

    const { routerPass, ...fields } = validation.data;
    await routerRef.update({
      ...fields,
      ...(routerPass ? routerPasswordUpdateFields(routerPass) : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Credentials or IP may have changed; every location pointing at this
    // router must re-resolve rather than keep talking to the old address.
    invalidateRouterCache(tenantId);
    // Switching a router off, or setting its status, changes the offline
    // notice.
    invalidateTenantFleet(tenantId);

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
    const { tenantId } = await requireUnlockedOwner(authHeader);

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
    invalidateRouterCache(tenantId);
    invalidateTenantFleet(tenantId);

    return NextResponse.json({ success: true });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
