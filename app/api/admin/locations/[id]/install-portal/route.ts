import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS, COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import {
  ensurePortalDirectory,
  ensureWalledGarden,
  fetchPortalShim,
  probeMacLoginSupport,
  setHotspotHtmlDirectory,
  testRouterConnection,
  writePortalShim,
} from "@/lib/mikrotik";
import {
  PORTAL_HTML_DIRECTORY,
  buildPortalShim,
  walledGardenHosts,
} from "@/lib/hotspot-portal";

/**
 * Installs the captive portal on a location's router.
 *
 * Order is load-bearing. The walled garden goes first: if the pages were
 * swapped over before clients could reach us, every customer would be
 * redirected to a host their own router blocks, and the portal would be
 * worse than the MikroTik default it replaced.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);
    const { id: locationId } = await params;

    const locationDoc = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(locationId)
      .get();

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

    const tenantDoc = await adminDb
      .collection(COLLECTIONS.TENANTS)
      .doc(tenantId)
      .get();
    const slug = tenantDoc.data()?.slug as string | undefined;

    if (!slug) {
      return NextResponse.json(
        { success: false, error: "Tenant slug not found" },
        { status: 404 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
      return NextResponse.json(
        { success: false, error: "App URL not configured" },
        { status: 500 }
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

    const { host } = new URL(appUrl);

    // 1. Let clients reach the portal before they're authenticated.
    const garden = await ensureWalledGarden(routerConfig, walledGardenHosts(host));

    // 2. The directory has to exist before anything can be written into
    //    it -- `/tool fetch` doesn't create one.
    const directoryReady = await ensurePortalDirectory(
      routerConfig,
      PORTAL_HTML_DIRECTORY
    );
    if (!directoryReady.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Couldn't create the portal directory: ${directoryReady.error}`,
          data: { walledGarden: garden.data },
        },
        { status: 502 }
      );
    }

    // 3. Write the shim in, leaving MikroTik's stock pages untouched.
    //
    //    Contents go over the REST API rather than having the router fetch
    //    them: `/tool fetch` is gated by RouterOS device-mode, which can
    //    only be changed by physically pressing the device's reset button.
    //    `fetch` stays as a fallback for the reverse case.
    const { protocol, host: appHost } = new URL(appUrl);
    const portalUrl = `${protocol}//${slug}.${appHost}/portal`;
    const templateUrl = `${appUrl}/api/hotspot/portal-template/${slug}`;

    let shim = await writePortalShim(
      routerConfig,
      PORTAL_HTML_DIRECTORY,
      buildPortalShim(portalUrl)
    );
    let shimMethod = "rest";

    if (!shim.success) {
      const fetched = await fetchPortalShim(
        routerConfig,
        templateUrl,
        PORTAL_HTML_DIRECTORY
      );
      if (fetched.success) {
        shim = fetched;
        shimMethod = "fetch";
      } else {
        return NextResponse.json(
          {
            success: false,
            error: `Couldn't install the portal page. Writing it directly failed (${shim.error}), and fetching it failed (${fetched.error}).`,
            data: { walledGarden: garden.data },
          },
          { status: 502 }
        );
      }
    }

    // 4. Switch the hotspot over. Reverting is this one field.
    const directory = await setHotspotHtmlDirectory(
      routerConfig,
      PORTAL_HTML_DIRECTORY
    );
    if (!directory.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Portal page installed, but the hotspot still points at the old one: ${directory.error}`,
          data: { walledGarden: garden.data },
        },
        { status: 502 }
      );
    }

    // 5. Tells us whether webhook-driven auto-login is available on this
    //    hardware. Informational -- never fails the install.
    const macLogin = await probeMacLoginSupport(routerConfig);

    await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(locationId)
      .set(
        {
          portalInstalledAt: new Date(),
          portalHtmlDirectory: PORTAL_HTML_DIRECTORY,
          // What the profiles pointed at before, so uninstall restores the
          // tenant's own directory rather than guessing at the default.
          portalPreviousHtmlDirectory: directory.data?.previous?.[0] ?? "hotspot",
          macLoginSupported: macLogin.data?.supported ?? null,
        },
        { merge: true }
      );

    return NextResponse.json({
      success: true,
      data: {
        directory: PORTAL_HTML_DIRECTORY,
        shimMethod,
        profilesUpdated: directory.data?.profiles ?? 0,
        walledGarden: garden.data,
        macLogin: macLogin.data,
        templateUrl,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
