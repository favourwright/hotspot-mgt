import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateTenant } from "@/lib/tenant-cache";

/**
 * What renewing means at this tenant: whether a repeat purchase adds to the
 * customer's remaining time and data, or starts both again.
 *
 * Owner-only, with no GET, for the same reason as portal-settings: the
 * plans page already loads the tenant document these two fields live on, so
 * a read endpoint would be a second way to get them and a second thing to
 * keep in step.
 *
 * Tenant-wide and not per plan deliberately - see `Tenant.renewalExpiryMode`.
 * Nothing already sold is affected either way: a renewal records the modes
 * that were in force when it ran (`Voucher.renewal`), so flipping a switch
 * here changes the next purchase and never rewrites the last one.
 */

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  renewalExpiryMode: z.enum(["extend", "reset"]),
  renewalDataMode: z.enum(["carry", "reset"]),
});

export async function PATCH(request: NextRequest) {
  try {
    const { tenantId } = await requireUnlockedOwner(
      request.headers.get("authorization")
    );

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid renewal settings" },
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
      renewalExpiryMode: parsed.data.renewalExpiryMode,
      renewalDataMode: parsed.data.renewalDataMode,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // The checkout preview reads the tenant through the same cache the
    // portal does, so without this an owner saves, reopens the dialog and
    // is still promised the old rule for up to the cache TTL.
    const slug = snapshot.data()?.slug;
    if (slug) invalidateTenant(slug);

    return NextResponse.json({ success: true, data: parsed.data });
  } catch (error) {
    console.error("Renewal settings update error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
