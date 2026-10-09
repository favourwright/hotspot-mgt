import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { getRouterForLocation } from "@/lib/router-config";
import { hotspotUserExists } from "@/lib/mikrotik";

const bodySchema = z.object({ archived: z.boolean() });

/**
 * Dismisses a voucher from the hotspot-users reconciliation view, or brings
 * it back.
 *
 * The case this exists for: a voucher the router has no matching user for
 * and never will, because someone removed it by hand in Winbox long ago.
 * The row is permanent noise, but the sale was real.
 *
 * So this sets a flag rather than deleting the document. Every dashboard
 * counts the vouchers collection with live `count()` queries, the matching
 * payment stores this voucher's id, and the customer can read their own
 * vouchers -- a delete would silently reduce how much the tenant has ever
 * sold and strand both references. Only `getTenantVouchersByLocation`, which
 * feeds this one view, honours the flag.
 *
 * Archiving is refused while the user still exists on the router: the merge
 * joins on username, so hiding the platform side of a pair that the router
 * still has would just turn the row into a bogus "created outside the
 * platform" entry. An unreachable router is refused for the same reason --
 * it cannot be told apart from an empty one.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const { id: voucherId } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const { archived } = parsed.data;

    const voucherRef = adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(voucherId);
    const voucherDoc = await voucherRef.get();
    const voucher = voucherDoc.data();

    if (!voucherDoc.exists || !voucher) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    if (archived) {
      const router = await getRouterForLocation(tenantId, voucher.locationId);
      if (!router) {
        return NextResponse.json(
          { success: false, error: "Router not found for this location" },
          { status: 404 }
        );
      }

      const exists = await hotspotUserExists(router.config, voucher.username);
      if (!exists.success) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Can't reach the router to check this user still isn't there. Try again once it's back.",
          },
          { status: 503 }
        );
      }
      if (exists.data) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This user does exist on the router, so there's no drift to dismiss. Refresh the list.",
          },
          { status: 409 }
        );
      }
    }

    await voucherRef.update({
      archivedAt: archived ? FieldValue.serverTimestamp() : null,
    });

    return NextResponse.json({ success: true, data: { archived } });
  } catch (error) {
    console.error("Voucher archive error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
