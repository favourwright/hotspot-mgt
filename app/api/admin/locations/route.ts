import { routerLogin } from "@/lib/router-credentials";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { assertWithinPlanLimit } from "@/lib/plan-resource-limit-check";
import { testRouterConnection } from "@/lib/mikrotik";
import { invalidateTenantFleet } from "@/lib/tenant-fleet";
import { z } from "zod";

const createLocationSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  routerId: z.string().min(1, "Router is required"),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const verifiedUser = await verifyTenantAccessBySlug(authHeader, tenantSlug);
    const { tenantId } = verifiedUser;

    // Fetch all locations (no credentials stored here anymore)
    const locationsSnapshot = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .orderBy("createdAt", "desc")
      .get();

    // Hand-built rather than LocationSchema.parse, so one malformed document
    // degrades to defaults instead of 500-ing the whole list. The cost is
    // that this mapping has to track the schema by hand: a field added there
    // and forgotten here is silently absent from every client that refetches,
    // while a server-rendered page still shows it. That is exactly how the
    // portal button stayed on "Install" until a manual reload - the install
    // succeeded, the refetch dropped `portalInstalledAt`, and the UI had
    // nothing to switch on.
    const locations = locationsSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data?.name || 'Unknown Location',
        routerId: data?.routerId || '',
        active: data?.active ?? false,
        createdAt: data?.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data?.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        // Captive portal state. `portalInstalledAt` is what the admin UI
        // switches Install/Uninstall on.
        portalInstalledAt: data?.portalInstalledAt?.toDate?.()?.toISOString() ?? null,
        portalHtmlDirectory: data?.portalHtmlDirectory ?? null,
        portalPreviousProfiles: data?.portalPreviousProfiles ?? null,
        portalPreviousHtmlDirectory: data?.portalPreviousHtmlDirectory ?? null,
        macLoginSupported: data?.macLoginSupported ?? null,
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
    const verifiedUser = await requireUnlockedOwner(authHeader);
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

    const { name, routerId } = validationResult.data;

    await assertWithinPlanLimit(tenantId, "maxLocations");

    // Fetch router details
    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(routerId)
      .get();

    if (!routerDoc.exists) {
      return NextResponse.json(
        {
          success: false,
          error: "Router not found",
        },
        { status: 404 }
      );
    }

    const routerData = routerDoc.data()!;

    // One location per router. Every router-side operation a location drives
    // (portal install, profile list, hotspot users, active sessions) is
    // router-wide rather than scoped to the location, so a second location
    // here would share and overwrite the first one's state with no error.
    // The dialog already hides a taken router; this is so the API isn't the
    // weaker check. See `docs/locations-and-routers.md`.
    const existingForRouter = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .where("routerId", "==", routerId)
      .limit(1)
      .get();

    if (!existingForRouter.empty) {
      const existingName = existingForRouter.docs[0].data().name as string;
      return NextResponse.json(
        {
          success: false,
          error: `This router already backs the location "${existingName}". Register another router to add a location.`,
        },
        { status: 409 }
      );
    }

    // Check router is active and online
    if (!routerData.active) {
      return NextResponse.json(
        {
          success: false,
          error: "Router is not active",
        },
        { status: 400 }
      );
    }

    if (routerData.status !== "online") {
      return NextResponse.json(
        {
          success: false,
          error: "Router is not online. Please check router connection.",
        },
        { status: 400 }
      );
    }

    // Fresh credential test
    const freshTest = await testRouterConnection({
      ip: routerData.routerIp,
      ...routerLogin(routerData),
    });

    if (!freshTest.success) {
      // Update router status to offline
      await adminDb
        .collection(TENANT_COLLECTIONS.routers(tenantId))
        .doc(routerId)
        .update({
          status: "offline",
          updatedAt: new Date(),
        });
      invalidateTenantFleet(tenantId);

      return NextResponse.json(
        {
          success: false,
          error:
            "Router is currently unreachable. " +
            "Please check the connection and try again.",
        },
        { status: 400 }
      );
    }

    // Update router status to confirm it's online
    await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(routerId)
      .update({
        status: "online",
        updatedAt: new Date(),
      });

    // Create location document - only name and routerId
    // Router credentials are NEVER stored in location
    const locationRef = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .add({
        name,
        routerId,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

    // Status may have flipped above, and the first location is what ends
    // setup and changes the nav.
    invalidateTenantFleet(tenantId);

    const locationDoc = await locationRef.get();
    const locationData = locationDoc.data();

    return NextResponse.json({
      success: true,
      data: {
        id: locationRef.id,
        name: locationData?.name || "",
        routerId: locationData?.routerId || "",
        active: locationData?.active ?? true,
        createdAt:
          locationData?.createdAt?.toDate?.()?.toISOString() ||
          new Date().toISOString(),
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
