import { NextRequest, NextResponse, after } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import {
  HotspotProfileDirectory,
  removeOurWalledGardenEntries,
  restoreHotspotHtmlDirectories,
  setHotspotHtmlDirectory,
  testRouterConnection,
} from "@/lib/mikrotik";
import { PORTAL_HTML_DIRECTORY } from "@/lib/hotspot-portal";
import { syncTenantHookGardenLater } from "@/lib/hook-walled-garden";

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
    const { tenantId } = await requireUnlockedOwner(authHeader);
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

    // 1. Point each hotspot profile back at whatever IT used before we
    //    touched it. Per-profile, because a router can carry several
    //    pointing at different directories and setting them all to one
    //    value would overwrite the tenant's own pages rather than restore
    //    them. See `docs/locations-and-routers.md`.
    const captured = (locationData.portalPreviousProfiles ??
      []) as HotspotProfileDirectory[];

    // Never restore onto our own directory: that would leave our portal
    // serving after an uninstall that reported success, with the walled
    // garden already withdrawn from under it.
    // Matched on the last path segment so "flash/hotspot-oga" is caught as
    // well as the bare name. A router with flash storage reports the prefixed
    // form, and letting it through restores the portal we are uninstalling.
    const toRestore = captured.filter(
      (profile) =>
        profile.htmlDirectory.split("/").pop() !== PORTAL_HTML_DIRECTORY
    );

    let profilesUpdated: number;
    let restoredTo: string;

    if (toRestore.length > 0) {
      const restored = await restoreHotspotHtmlDirectories(
        routerConfig,
        toRestore
      );
      if (!restored.success) {
        return NextResponse.json(
          {
            success: false,
            error: `Couldn't restore the hotspot pages: ${restored.error}`,
          },
          { status: 502 }
        );
      }
      profilesUpdated = restored.data?.restored ?? 0;
      restoredTo = [
        ...new Set(toRestore.map((profile) => profile.htmlDirectory)),
      ].join(", ");
    } else {
      // Installed before the per-profile capture existed, so the single
      // legacy value is all we have. "hotspot" is the last resort, and is
      // a guess at MikroTik's default rather than a real restore.
      // Compared on the last path segment, not the whole string: on a router
      // with flash storage this value is "flash/hotspot-oga", which a bare
      // equality check against "hotspot-oga" lets straight through, and the
      // uninstall would restore the router onto the portal it is removing.
      const recorded: string | undefined =
        locationData.portalPreviousHtmlDirectory;
      const isOurOwn =
        recorded !== undefined &&
        recorded.split("/").pop() === PORTAL_HTML_DIRECTORY;

      const legacy: string = recorded && !isOurOwn ? recorded : "hotspot";

      const restored = await setHotspotHtmlDirectory(routerConfig, legacy);
      if (!restored.success) {
        return NextResponse.json(
          {
            success: false,
            error: `Couldn't restore the hotspot pages: ${restored.error}`,
          },
          { status: 502 }
        );
      }
      profilesUpdated = restored.data?.profiles ?? 0;
      restoredTo = legacy;
    }

    // 2. Only then withdraw the walled garden.
    const garden = await removeOurWalledGardenEntries(routerConfig);

    await locationRef.set(
      {
        portalInstalledAt: null,
        portalHtmlDirectory: null,
        portalPreviousProfiles: null,
        macLoginSupported: null,
      },
      { merge: true }
    );

    // The hook's verification host went with the rest of our entries;
    // refresh the hooks page's count of routers that carry it.
    syncTenantHookGardenLater(tenantId, after);

    return NextResponse.json({
      success: true,
      data: {
        restoredTo,
        profilesUpdated,
        walledGardenRemoved: garden.data?.removed ?? 0,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
