import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getAllTenants } from "@/lib/firestore-helpers";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as
      | "active"
      | "suspended"
      | "pending"
      | null;

    const tenants = await getAllTenants(status ? { status } : undefined);

    // Never return sensitive data
    const safeTenants = tenants.map((tenant) => ({
      id: tenant.id,
      slug: tenant.slug,
      businessName: tenant.businessName,
      ownerEmail: tenant.ownerEmail,
      status: tenant.status,
      planId: tenant.planId,
      planName: tenant.planName,
      platformFeePercent: tenant.platformFeePercent,
      monthlyFee: tenant.monthlyFee,
      paymentGateway: tenant.paymentGateway,
      nextBillingDate: tenant.nextBillingDate,
      paystackSubaccountCode: tenant.paystackSubaccountCode,
      bankName: tenant.bankName,
      accountNumber: tenant.accountNumber
        ? `****${tenant.accountNumber.slice(-4)}`
        : null,
      accountName: tenant.accountName,
      createdAt: tenant.createdAt,
    }));

    return NextResponse.json({
      success: true,
      data: safeTenants,
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
