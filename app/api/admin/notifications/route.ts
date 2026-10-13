import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  handleAuthError,
  verifyOwnerWithTenant,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import {
  getNotificationSettings,
  setOptOuts,
} from "@/lib/notification-prefs";

/**
 * An owner's own email preferences.
 *
 * Reads go through verifyTenantAccessBySlug so a superadmin can see what a
 * tenant has configured, exactly as they can on every other admin page.
 * Writes stay on verifyOwnerWithTenant: muting someone else's mail is not a
 * thing a superadmin should be able to do by viewing their account, and the
 * platform-wide switch at /superadmin/emails already exists for the case
 * where an email genuinely has to stop going out.
 */

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  /**
   * Every optional key the form rendered, with its switch position. A full
   * replacement rather than a delta, so a stale tab cannot silently undo a
   * change made elsewhere by sending only the one key it knows about.
   */
  settings: z.record(z.string(), z.boolean()),
});

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyTenantAccessBySlug(
      request.headers.get("authorization"),
      request.headers.get(TENANT_SLUG_HEADER)
    );

    return NextResponse.json({
      success: true,
      data: await getNotificationSettings(tenantId),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(
      request.headers.get("authorization")
    );

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid notification settings" },
        { status: 400 }
      );
    }

    // The stored field is the list of muted keys, so an enabled switch is an
    // absence. Inverting here keeps the UI talking in "on/off", which is what
    // an owner is actually choosing.
    const muted = Object.entries(parsed.data.settings)
      .filter(([, enabled]) => !enabled)
      .map(([key]) => key);

    await setOptOuts(tenantId, muted);

    return NextResponse.json({
      success: true,
      data: await getNotificationSettings(tenantId),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
