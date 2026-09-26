import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { testRouterConnection } from "@/lib/mikrotik";
import { z } from "zod";

const createLocationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  routerIp: z
    .string()
    .regex(
      /^(\d{1,3}\.){3}\d{1,3}$/,
      "Invalid IP address format"
    ),
  routerUser: z.string().min(1, "Router username is required"),
  routerPass: z.string().min(1, "Router password is required"),
  wireguardPublicKey: z.string().optional(),
  wireguardTunnelIp: z.string().optional(),
  connectionMethod: z.enum(["wireguard", "direct"]).default("direct"),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    // Fetch all locations without credentials
    const locationsSnapshot = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .orderBy("createdAt", "desc")
      .get();

    const locations = locationsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data?.name || 'Unknown Location',
        routerIp: data?.routerIp || '',
        active: data?.active ?? false,
        createdAt: data?.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data?.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        // NEVER return routerUser or routerPass
      };
    });

    return NextResponse.json({
      success: true,
      data: locations,
    });
  } catch (error) {
    console.error("GET locations error:", error);
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
    const validationResult = createLocationSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { name, routerIp, routerUser, routerPass, wireguardPublicKey, wireguardTunnelIp, connectionMethod } = validationResult.data;

    // Test connection before saving for direct connections only
    // WireGuard connections already verified by polling step
    if (connectionMethod === "direct") {
      const testResult = await testRouterConnection({
        ip: routerIp,
        username: routerUser,
        password: routerPass,
      });

      if (!testResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: `Connection test failed: ${testResult.error}`,
          },
          { status: 400 }
        );
      }
    }

    // Create location document
    const locationRef = await adminDb.collection(TENANT_COLLECTIONS.locations(tenantId)).add({
      name,
      routerIp,
      routerUser,
      routerPass,
      active: true,
      wireguardPublicKey: wireguardPublicKey || null,
      wireguardTunnelIp: wireguardTunnelIp || null,
      connectionMethod: connectionMethod || "direct",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const locationDoc = await locationRef.get();
    const locationData = locationDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: locationRef.id,
        name: locationData?.name || '',
        routerIp: locationData?.routerIp || '',
        active: locationData?.active ?? true,
        createdAt: locationData?.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("POST location error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
