import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import {
  getCustomerVouchers,
  getTenantBySlug,
  getTenantCustomer,
  getTenantCustomerCount,
} from "@/lib/firestore-helpers";
import { getBillingPlanById } from "@/lib/billing-plans";
import { resolveVoucherAction } from "@/lib/voucher-renewal";

// Checked by the customer portal right before opening the Paystack popup -
// this is the actual enforcement point for a plan's maxCustomers limit.
// Existing customers of a tenant always pass; only a brand-new customer can
// be blocked, and only before they've paid - /api/payment/verify never
// blocks fulfillment after a payment has already gone through.
//
// It is also the only place a purchase is refused for already owning an
// unused voucher. That check needs `planId` and `locationId`, which are
// optional here: a caller that does not send them gets the customer-limit
// answer alone, exactly as before.
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

    // Before anything about limits: has this person already bought this
    // exact plan here and never used it?
    //
    // A voucher that has never been logged into has no clock running, so
    // there is nothing to extend - the profile's on-login script knows one
    // duration and stamps it once, which is why two unactivated purchases
    // cannot stack into one credential (lib/voucher-renewal.ts). Selling a
    // second one would take their money for a code that does exactly what
    // the one already in their inbox does.
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get("planId");
    const locationId = searchParams.get("locationId");

    if (planId && locationId) {
      const history = await getCustomerVouchers(tenant.id, verifiedUser.uid);
      const action = resolveVoucherAction(history, {
        planId,
        locationId,
        now: new Date(),
      });

      if (action.kind === "unactivated") {
        return NextResponse.json({
          success: true,
          data: {
            allowed: false,
            reason:
              "You already have a voucher for this plan that has not been used yet. Sign in with it first - buying another would not give you any more time.",
          },
        });
      }
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
