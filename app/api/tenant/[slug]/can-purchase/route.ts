import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { getTenantBySlug, getTenantCustomer, getTenantCustomerCount } from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";

// Checked by the customer portal right before opening the Paystack popup -
// this is the actual enforcement point for a plan's maxCustomers limit.
// Existing customers of a tenant always pass; only a brand-new customer can
// be blocked, and only before they've paid - /api/payment/verify never
// blocks fulfillment after a payment has already gone through.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyAuthenticated(authHeader);

    const { slug } = await params;
    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    const existingCustomer = await getTenantCustomer(tenant.id, verifiedUser.uid);
    if (existingCustomer) {
      return NextResponse.json({ success: true, data: { allowed: true } });
    }

    const plan = await getBillingPlanById(tenant.planId);
    const maxCustomers = plan?.limits.maxCustomers ?? null;

    if (maxCustomers === null) {
      return NextResponse.json({ success: true, data: { allowed: true } });
    }

    const currentCount = await getTenantCustomerCount(tenant.id);

    if (currentCount >= maxCustomers) {
      return NextResponse.json({
        success: true,
        data: {
          allowed: false,
          reason: "This business isn't accepting new customers right now. Please check back later.",
        },
      });
    }

    return NextResponse.json({ success: true, data: { allowed: true } });
  } catch (error) {
    console.error("Can-purchase check error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
