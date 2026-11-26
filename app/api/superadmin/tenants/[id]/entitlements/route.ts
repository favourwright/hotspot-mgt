/**
 * Grant or withdraw an addon entitlement for one tenant. Superadmin only.
 *
 * This writes the same document `npm run addons:seed -- --grandfather`
 * writes, and for the same reason: a permanent, non-lapsing grant for
 * someone who should have the feature without paying for it. The difference
 * is only that this one can be done from the UI, for any tenant, at any
 * time, rather than requiring a script run that knows how to find them.
 *
 * `source: "grant"` rather than "purchase", so revenue reporting and anyone
 * asking "why does this tenant have this" can tell a comp from a sale.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS, TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { isAddonKey } from "@/lib/addon-catalog";
import { z } from "zod";

const bodySchema = z.object({
  addonKey: z.string().min(1, "Addon is required"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

    const validation = bodySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { addonKey } = validation.data;
    // A key no gate references would be listed and grantable while
    // enforcing nothing, which is exactly what the catalog exists to stop.
    if (!isAddonKey(addonKey)) {
      return NextResponse.json(
        { success: false, error: "Unknown addon" },
        { status: 400 }
      );
    }

    if (!(await adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId).get()).exists) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    const now = new Date();
    await adminDb
      .collection(TENANT_COLLECTIONS.entitlements(tenantId))
      .doc(addonKey)
      .set({
        addonKey,
        source: "grant",
        status: "active",
        // one_time never expires and ignores currentPeriodEnd, which is what
        // "they have this because we said so" should mean.
        pricingModel: "one_time",
        lastPaymentRef: null,
        amountPaid: 0,
        grantedAt: now,
        currentPeriodEnd: null,
        pastDueSince: null,
        cancelledAt: null,
        updatedAt: now,
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("POST entitlement error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * Withdraw a grant.
 *
 * Refuses to touch anything that was actually paid for. Deleting a
 * purchased entitlement would take away time a tenant has paid for; it runs
 * out by itself at the end of the period.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id: tenantId } = await params;

    const validation = bodySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const ref = adminDb
      .collection(TENANT_COLLECTIONS.entitlements(tenantId))
      .doc(validation.data.addonKey);
    const doc = await ref.get();

    if (!doc.exists) {
      return NextResponse.json(
        { success: false, error: "No entitlement to withdraw" },
        { status: 404 }
      );
    }

    if (doc.data()?.source !== "grant") {
      return NextResponse.json(
        {
          success: false,
          error:
            "This addon was paid for, not granted. It runs out by itself at the end of the period paid for.",
        },
        { status: 409 }
      );
    }

    await ref.delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE entitlement error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
