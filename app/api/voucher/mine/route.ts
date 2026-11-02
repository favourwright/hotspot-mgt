import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { rateLimit } from "@/lib/rate-limit";
import {
  CUSTOMER_VOUCHER_LIMIT,
  CUSTOMER_VOUCHER_PAGE,
  isPlainDocumentId,
  serializeCustomerVoucher,
} from "@/lib/customer-voucher";

/**
 * The signed-in customer's own vouchers at one tenant, newest first.
 *
 * The filter is the verified uid, never anything in the request, so the only
 * thing a tenant id can change is which of their own vouchers they see.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuthenticated(request.headers.get("authorization"));

    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!isPlainDocumentId(tenantId)) {
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

    const snapshot = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .where("userId", "==", user.uid)
      .orderBy("createdAt", "desc")
      .limit(CUSTOMER_VOUCHER_PAGE)
      .get();

    return NextResponse.json({
      success: true,
      data: snapshot.docs.map((doc) => serializeCustomerVoucher(doc.id, doc.data())),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
