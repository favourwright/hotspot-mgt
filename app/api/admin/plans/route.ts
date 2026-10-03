import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  verifyOwnerWithTenant,
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { z } from "zod";

const createPlanSchema = z.object({
  locationId: z.string().min(1, "Location is required"),
  locationName: z.string().min(1, "Location name is required"),
  name: z.string().min(2, "Plan name must be at least 2 characters"),
  price: z.number().min(1, "Price must be greater than 0"),
  duration: z.string().min(1, "Duration is required"),
  routerDurationValue: z.number().int().min(1, "Router duration value is required"),
  routerDurationUnit: z.enum(["h", "d"], { message: "Router duration unit must be 'h' or 'd'" }),
  dataLimit: z.string().min(1, "Data limit is required"),
  mikrotikProfile: z.string().min(1, "MikroTik profile is required"),
  active: z.boolean().default(true),
  sameCredentials: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const verifiedUser = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const { tenantId } = verifiedUser;

    // Get locationId filter from query params
    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    let query = adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).orderBy("createdAt", "desc");

    if (locationId) {
      query = query.where("locationId", "==", locationId) as FirebaseFirestore.Query;
    }

    const plansSnapshot = await query.get();

    const plans = plansSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        locationId: data.locationId,
        locationName: data.locationName,
        name: data.name,
        price: data.price,
        duration: data.duration,
        routerDurationValue: data.routerDurationValue,
        routerDurationUnit: data.routerDurationUnit,
        dataLimit: data.dataLimit,
        mikrotikProfile: data.mikrotikProfile,
        active: data.active,
        sameCredentials: data.sameCredentials ?? true,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      };
    });

    return NextResponse.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("GET plans error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    const body = await request.json();
    const validationResult = createPlanSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const planData = validationResult.data;

    // Create plan document
    const planRef = await adminDb.collection(TENANT_COLLECTIONS.plans(tenantId)).add({
      ...planData,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const planDoc = await planRef.get();
    const data = planDoc.data();

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
    console.error("POST plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
