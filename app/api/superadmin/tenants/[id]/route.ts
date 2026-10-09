import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { invalidateTenant } from "@/lib/tenant-cache";
import { FieldValue } from "firebase-admin/firestore";
import { notifyTenantStatusChanged } from "@/lib/notifications";

const updateTenantSchema = z.object({
  status: z.enum(["active", "suspended", "pending"]).optional(),
  subscriptionStatus: z
    .enum(["active", "past_due", "cancelled", "pending"])
    .nullable()
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const { id: tenantId } = await params;

    const body = await request.json();
    const validation = updateTenantSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
    const tenantDoc = await tenantRef.get();

    if (!tenantDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const previousStatus = tenantDoc.data()?.status;

    await tenantRef.update({
      ...validation.data,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Only on an actual transition - re-saving the same status should not
    // mail the owner again. "pending" is deliberately not announced: it is an
    // internal state no owner has a useful action to take on.
    const nextStatus = validation.data.status;
    if (
      nextStatus &&
      nextStatus !== previousStatus &&
      (nextStatus === "suspended" || nextStatus === "active")
    ) {
      await notifyTenantStatusChanged(tenantId, nextStatus);
    }

    // Drop the cached copy so the change is visible on the next request
    // rather than up to a minute later. Use the stored slug, not the
    // incoming body - a slug change has to clear the entry under the old one.
    const previousSlug = tenantDoc.data()?.slug;
    if (previousSlug) invalidateTenant(previousSlug);
    const nextSlug = (validation.data as { slug?: string }).slug;
    if (nextSlug && nextSlug !== previousSlug) invalidateTenant(nextSlug);

    return NextResponse.json({ success: true });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
