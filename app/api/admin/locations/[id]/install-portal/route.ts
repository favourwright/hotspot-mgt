import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS, COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import {
  ensurePortalDirectory,
  ensureWalledGarden,
  fetchPortalShim,
  probeMacLoginSupport,
  resolveHotspotDirectory,
  setHotspotHtmlDirectory,
  testRouterConnection,
  writePortalFile,
  writePortalShim,
} from "@/lib/mikrotik";
import {
  PORTAL_HTML_DIRECTORY,
  buildAloginPage,
  buildPortalShim,
  buildStatusPage,
  walledGardenHosts,
} from "@/lib/hotspot-portal";
import { refreshPlanMap } from "@/lib/plan-map";

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

    // Re-installing over a live install would capture our OWN directory as
    // the thing to restore, and the tenant's real pages would be lost for
    // good. The dropdown already offers only one of install/uninstall, so
    // this catches a stale client or a direct API call.
    if (locationData.portalInstalledAt) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The portal is already installed here. Remove it first if you " +
            "need to reinstall.",
        },
        { status: 409 }
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

    // 2. Work out where the directory actually has to live on this router
    //    before creating it. On a device with flash storage RouterOS serves
    //    `flash/hotspot-oga` while a bare write lands in `hotspot-oga` at
    //    the root, and the install silently has no effect.
    const resolved = await resolveHotspotDirectory(
      routerConfig,
      PORTAL_HTML_DIRECTORY
    );
    if (!resolved.success || !resolved.data) {
      return NextResponse.json(
        {
          success: false,
          error: `Couldn't read the router's hotspot profiles: ${resolved.error}`,
          data: { walledGarden: garden.data },
        },
        { status: 502 }
      );
    }
    const portalDirectory = resolved.data;

    //    The directory has to exist before anything can be written into
    //    it -- `/tool fetch` doesn't create one.
    const directoryReady = await ensurePortalDirectory(
      routerConfig,
      portalDirectory
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
      portalDirectory,
      buildPortalShim(portalUrl)
    );
    let shimMethod = "rest";

    if (!shim.success) {
      const fetched = await fetchPortalShim(
        routerConfig,
        templateUrl,
        portalDirectory
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

    // 4. The two pages the router renders itself, for a client who is
    //    already authenticated. Unlike the login shim these never leave the
    //    router, so they cannot hit the mixed-content and walled-garden
    //    problems that the hosted portal has to work around.
    //
    //    A failure here is reported but does not fail the install: RouterOS
    //    populated this directory with its own stock copies when it created
    //    it, so the worst case is the customer seeing MikroTik's default
    //    status page rather than no page at all.
    const brandName = (tenantDoc.data()?.businessName as string) || slug;
    const pageErrors: string[] = [];

    for (const [filename, contents] of [
      ["alogin.html", buildAloginPage({ brandName })],
      ["status.html", buildStatusPage({ brandName })],
    ] as const) {
      const written = await writePortalFile(
        routerConfig,
        portalDirectory,
        filename,
        contents
      );
      if (!written.success) pageErrors.push(`${filename}: ${written.error}`);
    }

    //    Seeds the plan map those pages read, so the first customer to look
    //    sees their expiry and data allowance rather than blank blocks. It is
    //    refreshed from then on by the router-health cron (lib/cron-jobs.ts).
    const planMap = await refreshPlanMap(
      tenantId,
      routerConfig,
      portalDirectory
    );
    if (!planMap.success) pageErrors.push(`plan.json: ${planMap.error}`);

    // 5. Switch the hotspot over. Reverting is this one field.
    const directory = await setHotspotHtmlDirectory(
      routerConfig,
      portalDirectory
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

    // Compared against the RESOLVED directory, not the bare name. Matching on
    // "hotspot-oga" alone never excluded "flash/hotspot-oga", so a reinstall
    // recorded our own directory as the thing to restore and an uninstall
    // would have put the router back onto the portal it was removing.
    const previousProfiles = (directory.data?.previous ?? []).filter(
      (profile) =>
        profile.htmlDirectory !== portalDirectory &&
        profile.htmlDirectory !== PORTAL_HTML_DIRECTORY
    );

    // 6. Tells us whether webhook-driven auto-login is available on this
    //    hardware. Informational -- never fails the install.
    const macLogin = await probeMacLoginSupport(routerConfig);

    await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(locationId)
      .set(
        {
          portalInstalledAt: new Date(),
          portalHtmlDirectory: portalDirectory,
          // What each profile pointed at before, so uninstall restores the
          // tenant's own directories rather than guessing at the default.
          // Profiles already on our directory are dropped: that can only be
          // a leftover from an earlier install, and recording it would make
          // the restore a no-op.
          portalPreviousProfiles: previousProfiles,
          portalPreviousHtmlDirectory:
            previousProfiles[0]?.htmlDirectory ?? "hotspot",
          macLoginSupported: macLogin.data?.supported ?? null,
        },
        { merge: true }
      );

    return NextResponse.json({
      success: true,
      data: {
        directory: portalDirectory,
        shimMethod,
        profilesUpdated: directory.data?.profiles ?? 0,
        planEntries: planMap.data ?? 0,
        pageErrors,
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
