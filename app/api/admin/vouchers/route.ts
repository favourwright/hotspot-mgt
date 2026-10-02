import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { getTenantVouchers } from "@/lib/firestore-helpers";

// Backs useFailedVouchers()/useVouchers() query hooks — tenant-scoped,
// unlike the legacy flat-collection client-SDK reads those hooks used to do.
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);

    const statusParam = request.nextUrl.searchParams.get("status");
    const status =
      statusParam === "active" || statusParam === "expired" || statusParam === "failed"
        ? statusParam
        : undefined;

    const vouchers = await getTenantVouchers(verifiedUser.tenantId, status);

    return NextResponse.json({ success: true, data: vouchers });
  } catch (error) {
    console.error("Vouchers fetch error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
