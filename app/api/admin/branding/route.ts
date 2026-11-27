import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateTenant } from "@/lib/tenant-cache";
import { planIncludesBranding } from "@/lib/portal-branding";
import { checkLogoDataUri, normalizeAccentColor } from "@/lib/branding";

/**
 * A tenant's logo and accent colour for their captive portal.
 *
 * Owner-only and with no GET, like /api/admin/portal-settings beside it: the
 * settings page reads the branding off the tenant document it already
 * loads.
 *
 * **Saving needs a plan with `features.customBranding`; clearing never
 * does.** An owner who has moved to a plan without it must still be able to
 * take their logo down, the same reason uninstalling the portal is ungated.
 * Display is gated separately (lib/portal-branding.ts), so nothing saved
 * here reaches a customer without the plan feature either way.
 *
 * Everything the browser did to the logo is redone here as a check:
 * lib/branding.ts sniffs the type from the file's own bytes, reads its
 * dimensions from the header and enforces the size cap. The page compresses
 * a logo to fit as a courtesy; this is the boundary.
 */

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  // The body cap is enforced by checkLogoDataUri; this only stops a
  // megabyte of text reaching it.
  logo: z.string().max(16_384).nullable(),
  accentColor: z.string().max(16).nullable(),
});

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await requireUnlockedOwner(
      request.headers.get("authorization")
    );

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid branding" },
        { status: 400 }
      );
    }

    const logo = parsed.data.logo;
    const typedAccent = parsed.data.accentColor?.trim() || null;
    const accentColor = typedAccent ? normalizeAccentColor(typedAccent) : null;

    if (typedAccent && !accentColor) {
      return NextResponse.json(
        { success: false, error: "Enter the colour as a hex code, like #1d4ed8." },
        { status: 400 }
      );
    }

    if (logo !== null) {
      const check = checkLogoDataUri(logo);
      if (!check.ok) {
        return NextResponse.json(
          { success: false, error: check.error },
          { status: 400 }
        );
      }
    }

    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
    const snapshot = await tenantRef.get();
    if (!snapshot.exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    // Only putting something up needs the plan feature. Taking everything
    // down is always allowed.
    if (
      (logo !== null || accentColor !== null) &&
      !(await planIncludesBranding(snapshot.data()?.planId))
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Your plan does not include custom branding. Change plan from the Billing plan section of Settings.",
        },
        { status: 403 }
      );
    }

    // Milliseconds rather than a counter: always increasing, needs no read
    // of the old value, and two saves in the same millisecond from one
    // owner are not a case worth a transaction.
    const version = Date.now();
    await tenantRef.update({
      branding: { logo, accentColor, version },
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The portal reads the tenant through getCachedTenantBySlug; without
    // this the owner reloads their portal and sees the old logo for up to
    // the cache TTL, which reads as the save not working.
    const slug = snapshot.data()?.slug;
    if (slug) invalidateTenant(slug);

    return NextResponse.json({
      success: true,
      data: { logo, accentColor, version },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
