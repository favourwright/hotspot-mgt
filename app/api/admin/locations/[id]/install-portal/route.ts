import { routerLogin } from "@/lib/router-credentials";
import { NextRequest, NextResponse, after } from "next/server";

import { ERRORS_FILE, buildErrorsFile } from "@/lib/hotspot-errors";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS, COLLECTIONS } from "@/lib/firebase-collections";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import {
  hookGardenHost,
  syncRouterHookGarden,
  syncTenantHookGardenLater,
} from "@/lib/hook-walled-garden";
import { AddonRequiredError, requireAddon } from "@/lib/entitlements";
import { getPortalBranding } from "@/lib/portal-branding";
import {
  brandSyncKey,
  portalBrandName,
  writePortalBrand,
} from "@/lib/portal-brand-sync";
import { TenantBrandingSchema } from "@/types/schemas";
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
  buildPortalShim,
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
    const { tenantId } = await requireUnlockedOwner(authHeader);
    const { id: locationId } = await params;

    // The paywall, before any side effect. Hiding the Install button is
    // presentation; this is the boundary, and it is the only one that holds
    // against a direct call to this endpoint.
    await requireAddon(tenantId, "captive-portal");

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
      ...routerLogin(routerData),
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

    // 1b. And the business's own verification page, if its decision hook
    //     has one: "Verify your account" opens it from behind the paywall.
    //     Its own comment, so it can be swapped alone and uninstall still
    //     withdraws it (lib/hook-walled-garden.ts). Not fatal: the portal
    //     works without it, and the next hook save retries.
    const hookHost = await hookGardenHost(tenantId).catch(() => null);
    const hookGarden = await syncRouterHookGarden(routerConfig, hookHost);
    if (!hookGarden.success) {
      console.warn(`[install-portal] hook walled garden not synced: ${hookGarden.error}`);
    }

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
    //    A failure here is reported but does not fail the install. The
    //    directory is created empty, so a missing page means RouterOS serves
    //    its own built-in default rather than nothing - degraded, not broken,
    //    and not worth failing an install that is otherwise complete.
    //
    //    errors.txt is in the same loop: it replaces RouterOS's English
    //    failure messages with stable tokens the portal maps to something a
    //    customer can act on (lib/hotspot-errors.ts). Without it the portal
    //    falls back to matching the stock wording, so this failing costs
    //    precision, not the feature.
    //    The pages and brand.json go together through writePortalBrand,
    //    the same writer router-health uses, so the key recorded below is
    //    exactly what a later pass compares against.
    const brandName = portalBrandName({ businessName: tenantDoc.data()?.businessName, slug });
    const savedBranding = TenantBrandingSchema.safeParse(tenantDoc.data()?.branding ?? {});
    const brandingData = savedBranding.success ? savedBranding.data : null;
    const branding = await getPortalBranding(
      tenantDoc.data()?.planId as string | undefined,
      brandingData
    );
    const pageErrors: string[] = [];

    const brandWrite = await writePortalBrand(routerConfig, portalDirectory, {
      brandName,
      branding,
    });
    pageErrors.push(...brandWrite.errors);

    const errorsFile = await writePortalFile(
      routerConfig,
      portalDirectory,
      ERRORS_FILE,
      buildErrorsFile()
    );
    if (!errorsFile.success) pageErrors.push(`${ERRORS_FILE}: ${errorsFile.error}`);

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
          // Only when every file landed: a partial write left unrecorded is
          // retried by the next router-health pass.
          portalBrandSynced: brandWrite.success
            ? brandSyncKey(branding, brandingData?.version ?? 0)
            : null,
        },
        { merge: true }
      );

    // This location now counts towards the hooks page's walled-garden line.
    if (hookHost) syncTenantHookGardenLater(tenantId, after);

    return NextResponse.json({
      success: true,
      data: {
        directory: portalDirectory,
        shimMethod,
        profilesUpdated: directory.data?.profiles ?? 0,
        planEntries: planMap.data ?? 0,
        pageErrors,
        walledGarden: garden.data,
        hookWalledGarden: { host: hookHost, synced: hookGarden.success },
        macLogin: macLogin.data,
        templateUrl,
      },
    });
  } catch (error) {
    // 402 rather than 403: this is not "you may not", it is "not yet paid
    // for", and the client renders a buy prompt off the distinction.
    if (error instanceof AddonRequiredError) {
      return NextResponse.json(
        {
          success: false,
          error:
            "The Captive Portal addon is required to install the portal.",
          data: { addonRequired: error.addonKey, reason: error.state.reason },
        },
        { status: 402 }
      );
    }

    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
