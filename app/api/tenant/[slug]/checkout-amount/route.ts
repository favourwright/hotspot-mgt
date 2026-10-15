import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { getTenantBySlug, parsePlan } from "@/lib/firestore-helpers";
import { getPlatformConfig } from "@/lib/platform-config";
import { estimatePaystackFee, computeCheckoutSplit } from "@/lib/paystack-fees";
import { resolvePaystackBearer } from "@/lib/billing-plans";

// Computed server-side, authoritatively, right before the customer-facing
// checkout dialog opens Paystack - never trust a client-supplied amount or
// split for real money. If PlatformConfig.paystackFeePassthrough is on, the
// customer's charge includes Paystack's estimated processing fee on top of
// the plan price; transactionCharge is the exact kobo amount that must go
// to the platform's main account so the tenant's subaccount still nets
// exactly its agreed share of the plan's own price, regardless of how
// accurate that fee estimate turns out to be (see lib/paystack-fees.ts and
// docs/billing-and-payments.md).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyAuthenticated(authHeader);

    const { slug } = await params;
    const planId = request.nextUrl.searchParams.get("planId");
    if (!planId) {
      return NextResponse.json(
        { success: false, error: "planId is required" },
        { status: 400 }
      );
    }

    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Business not found" },
        { status: 404 }
      );
    }

    const planDoc = await adminDb
      .collection(TENANT_COLLECTIONS.plans(tenant.id))
      .doc(planId)
      .get();
    const plan = parsePlan(planDoc);
    if (!plan) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    const platformConfig = await getPlatformConfig();
    const fee = estimatePaystackFee(plan.price, platformConfig.paystackFeePassthrough);

    // Shared with lib/portal-checkout.ts, which sells the same plans: a
    // split that differed between the storefront and the portal would mean
    // money moving differently depending on which page the buyer was on.
    const { amount, transactionCharge } = computeCheckoutSplit({
      priceKobo: plan.price,
      feeKobo: fee,
      platformFeePercent: tenant.platformFeePercent,
      bearer: await resolvePaystackBearer(tenant.planId),
      hasSubaccount: Boolean(tenant.paystackSubaccountCode),
    });

    return NextResponse.json({
      success: true,
      data: { amount, transactionCharge },
    });
  } catch (error) {
    console.error("Checkout amount error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
