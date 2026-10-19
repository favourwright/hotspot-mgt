import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { listHotspotProfiles, createHotspotProfile } from "@/lib/mikrotik";
import { getRouterForLocation } from "@/lib/router-config";
import {
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { z } from "zod";

const createProfileSchema = z.object({
  name: z.string().min(1, "Profile name is required"),
  rateLimit: z.string().optional(),
  keepaliveTimeout: z
    .string()
    .regex(/^(\d{2}:\d{2}:\d{2})?$/, "Format must be HH:MM:SS or empty")
    .optional(),
  sharedUsers: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const verifiedUser = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const { tenantId } = verifiedUser;

    const { id: locationId } = await params;

    const resolved = await getRouterForLocation(tenantId, locationId);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const result = await listHotspotProfiles(resolved.config);

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
    const verifiedUser = await requireUnlockedOwner(authHeader);
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

    const resolved = await getRouterForLocation(tenantId, locationId);
    if (!resolved) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const { name, rateLimit, keepaliveTimeout, sharedUsers } = validationResult.data;

    const result = await createHotspotProfile(resolved.config, {
      name,
      rateLimit,
      keepaliveTimeout,
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
