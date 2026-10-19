import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateTenant } from "@/lib/tenant-cache";
import { normalizeNigerianPhone } from "@/lib/phone";

/**
 * What a tenant chooses to put on their captive portal: the private-MAC
 * notice, and the support number customers can reach them on.
 *
 * Owner-only, with no GET. The settings page reads these straight off the
 * tenant document it already loads, so a read endpoint would be a second
 * way to get the same three fields and a second thing to keep in step.
 * `verifyOwnerWithTenant` rather than `verifyTenantAccessBySlug` for the
 * same reason every other admin write does: a superadmin viewing a tenant
 * stays read-only, and publishing a phone number on someone else's portal
 * is not a thing a page view should be able to do.
 */

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  portalMacNotice: z.boolean(),
  /**
   * As typed, in any of the forms an owner might use. Normalised below
   * rather than validated into shape here, so the error the form shows is
   * about the number being wrong rather than about a regex.
   *
   * An empty string is how the form says "remove it", which is a different
   * thing from "unchanged" and has to be expressible.
   */
  supportPhone: z.string().max(32),
  supportPhoneIsWhatsapp: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await requireUnlockedOwner(
      request.headers.get("authorization")
    );

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid portal settings" },
        { status: 400 }
      );
    }

    const typed = parsed.data.supportPhone.trim();
    const supportPhone = typed ? normalizeNigerianPhone(typed) : null;

    if (typed && !supportPhone) {
      return NextResponse.json(
        {
          success: false,
          error:
            "That doesn't look like a Nigerian mobile number. Enter it as 803 123 4567.",
        },
        { status: 400 }
      );
    }

    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
    const snapshot = await tenantRef.get();
    if (!snapshot.exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    await tenantRef.update({
      portalMacNotice: parsed.data.portalMacNotice,
      supportPhone,
      // Forced off with no number: the flag drives a WhatsApp icon that has
      // nothing to link to, and leaving it set would quietly re-enable the
      // icon the moment a number was entered again.
      supportPhoneIsWhatsapp: supportPhone
        ? parsed.data.supportPhoneIsWhatsapp
        : false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The portal reads the tenant document through getCachedTenantBySlug, so
    // without this the owner saves, reloads their portal and sees the old
    // value for up to the cache TTL - which reads as the save not working.
    const slug = snapshot.data()?.slug;
    if (slug) invalidateTenant(slug);

    return NextResponse.json({
      success: true,
      data: {
        portalMacNotice: parsed.data.portalMacNotice,
        supportPhone,
        supportPhoneIsWhatsapp: supportPhone
          ? parsed.data.supportPhoneIsWhatsapp
          : false,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
