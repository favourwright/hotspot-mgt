import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { listHotspotProfiles, createHotspotProfile, RouterConfig } from "@/lib/mikrotik";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { z } from "zod";

const createProfileSchema = z.object({
  name: z.string().min(1, "Profile name is required"),
  rateLimit: z.string().optional(),
  sessionTimeout: z
    .string()
    .regex(/^(\d{2}:\d{2}:\d{2})?$/, "Format must be HH:MM:SS or empty")
    .optional(),
  sharedUsers: z.string().optional(),
});

async function getRouterConfig(tenantId: string, locationId: string): Promise<RouterConfig | null> {
  const locationDoc = await adminDb
    .collection(TENANT_COLLECTIONS.locations(tenantId))
    .doc(locationId)
    .get();

  if (!locationDoc.exists) {
    return null;
  }

  const locationData = locationDoc.data();
  if (!locationData) {
    return null;
  }

  // Fetch router credentials via location's routerId
  const routerDoc = await adminDb
    .collection(TENANT_COLLECTIONS.routers(tenantId))
    .doc(locationData.routerId)
    .get();

  if (!routerDoc.exists) {
    return null;
  }

  const routerData = routerDoc.data();
  if (!routerData) {
    return null;
  }

  return {
    ip: routerData.routerIp,
    username: routerData.routerUser,
    password: routerData.routerPass,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    const { id: locationId } = await params;

    const routerConfig = await getRouterConfig(tenantId, locationId);
    if (!routerConfig) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const result = await listHotspotProfiles(routerConfig);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to fetch profiles from router" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data || [],
    });
  } catch (error) {
    console.error("GET profiles error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    const { id: locationId } = await params;

    const body = await request.json();
    const validationResult = createProfileSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const routerConfig = await getRouterConfig(tenantId, locationId);
    if (!routerConfig) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const { name, rateLimit, sessionTimeout, sharedUsers } = validationResult.data;

    const result = await createHotspotProfile(routerConfig, {
      name,
      rateLimit,
      sessionTimeout,
      sharedUsers,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "Failed to create profile on router" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("POST profile error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
