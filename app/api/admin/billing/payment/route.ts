/**
 * POST /api/admin/billing/payment: a tenant owner starts paying their plan for one
 * period. Returns Monnify's checkout (through Knomad Pay), which the settings dialog
 * shows in a frame; the payment is applied by /api/admin/billing/charges/[reference],
 * Knomad Pay's event, or the reconcile cron, whichever comes first.
 *
 * Owner-only, never superadmin: `verifyOwnerWithTenant` takes the tenant from the
 * caller's own claims, so there is no slug to spoof and no way to pay into somebody
 * else's account. Not behind the billing lock: paying is the way out of it.
 *
 * What is charged comes from `getPlanFeeState`'s quote, worked out here, never sent by
 * the browser: the period that starts where the paid (or free) time ends, at the plan's
 * fee less any live partial discount (lib/billing-periods.ts). Nothing renews by itself,
 * so there is nothing to cancel: a tenant who stops paying lapses through the grace
 * window, or moves to a free plan.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { getPlanFeeState } from "@/lib/fee-waivers";
import { startBillingCharge } from "@/lib/billing-charges";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const caller = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const state = await getPlanFeeState(caller.tenantId);
    if (!state) {
      return NextResponse.json({ success: false, error: "Tenant not found" }, { status: 404 });
    }
    if (!state.quote) {
      return NextResponse.json({ success: false, error: "There is nothing to pay right now." }, { status: 409 });
    }
    const tenant = (await adminDb.collection(COLLECTIONS.TENANTS).doc(caller.tenantId).get()).data();

    const started = await startBillingCharge({
      kind: "plan",
      tenantId: caller.tenantId,
      uid: caller.uid,
      email: caller.email,
      planId: tenant?.planId ?? null,
      priceKobo: state.quote.amountKobo,
      description: `${state.planName} plan, ${formatDay(state.quote.from)} to ${formatDay(state.quote.to)}`,
    });
    if (!started.ok) {
      return NextResponse.json({ success: false, error: started.error }, { status: started.status });
    }
    return NextResponse.json({
      success: true,
      data: {
        reference: started.reference,
        checkoutUrl: started.checkoutUrl,
        amount: started.amountKobo,
        coversFrom: state.quote.from.toISOString(),
        coversTo: state.quote.to.toISOString(),
      },
    });
  } catch (error) {
    console.error("POST billing payment error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
