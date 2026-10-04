import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import {
  removeOurWalledGardenEntries,
  setHotspotHtmlDirectory,
  testRouterConnection,
} from "@/lib/mikrotik";

/**
 * Puts the router's hotspot back the way it was.
 *
 * The reverse order of install: restore the pages first, so the moment
 * clients stop being sent to our portal is the moment we stop guaranteeing
 * they can reach it. Taking the walled garden down first would strand
 * anyone mid-purchase.
 *
 * The shim file is left on disk deliberately -- it's inert once nothing
 * points at it, and leaving it makes a reinstall a single field change.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);
    const { id: locationId } = await params;

    const locationRef = adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(locationId);
    const locationDoc = await locationRef.get();
    const locationData = locationDoc.data();

    if (!locationDoc.exists || !locationData) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(locationData.routerId)
      .get();
    const routerData = routerDoc.data();

    if (!routerDoc.exists || !routerData) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    const routerConfig = {
      ip: routerData.wireguardTunnelIp || routerData.routerIp,
      username: routerData.routerUser,
      password: routerData.routerPass,
    };

    const connection = await testRouterConnection(routerConfig);
    if (!connection.success) {
      return NextResponse.json(
        { success: false, error: `Router connection failed: ${connection.error}` },
        { status: 502 }
      );
    }

    // 1. Point the hotspot back at whatever it used before we touched it.
    const restoreTo: string =
      locationData.portalPreviousHtmlDirectory || "hotspot";
    const restored = await setHotspotHtmlDirectory(routerConfig, restoreTo);
    if (!restored.success) {
      return NextResponse.json(
        { success: false, error: `Couldn't restore the hotspot pages: ${restored.error}` },
        { status: 502 }
      );
    }

    // 2. Only then withdraw the walled garden.
    const garden = await removeOurWalledGardenEntries(routerConfig);

    await locationRef.set(
      {
        portalInstalledAt: null,
        portalHtmlDirectory: null,
        macLoginSupported: null,
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      data: {
        restoredTo: restoreTo,
        profilesUpdated: restored.data?.profiles ?? 0,
        walledGardenRemoved: garden.data?.removed ?? 0,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
