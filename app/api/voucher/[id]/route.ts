import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import {
  CUSTOMER_VOUCHER_LIMIT,
  isPlainDocumentId,
  serializeCustomerVoucher,
} from "@/lib/customer-voucher";

/**
 * One of the signed-in customer's own vouchers. Someone else's answers 404
 * rather than 403, the same as the usage route beside this: a customer has no
 * business learning which voucher ids exist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await verifyAuthenticated(request.headers.get("authorization"));

    const { id } = await params;
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!isPlainDocumentId(tenantId) || !isPlainDocumentId(id)) {
      return NextResponse.json(
        { success: false, error: "tenantId is required" },
        { status: 400 }
      );
    }

    if (!rateLimit(`customer-vouchers:${user.uid}`, CUSTOMER_VOUCHER_LIMIT).ok) {
      return NextResponse.json(
        { success: false, error: "Too many requests" },
        { status: 429 }
      );
    }

    const doc = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(id)
      .get();
    const data = doc.data();

    if (!doc.exists || !data || data.userId !== user.uid) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: serializeCustomerVoucher(doc.id, data),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
