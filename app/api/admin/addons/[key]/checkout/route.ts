import { NextRequest, NextResponse } from "next/server";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { getAddon, getEntitlementState } from "@/lib/entitlements";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { quoteAddonPeriod } from "@/lib/billing-periods";
import { startBillingCharge } from "@/lib/billing-charges";
import { formatDay } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/addons/[key]/checkout: a tenant owner starts paying for an addon.
 *
 * Returns Monnify's checkout (through Knomad Pay), which the marketplace shows in a
 * frame. A subscription addon is bought one period at a time, like the plan: nothing
 * renews by itself, and paying again within a week of the paid time ending extends it
 * from there (lib/billing-periods.ts). A one-time addon is bought once.
 *
 * Nothing here is an entitlement: the payment is applied by
 * /api/admin/billing/charges/[reference], Knomad Pay's event or the reconcile cron, from
 * the record written here (lib/billing-charges.ts). The price is the addon's live price,
 * read here, never sent by the browser.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const caller = await requireUnlockedOwner(request.headers.get("authorization"));
    const { tenantId } = caller;
    const { key } = await params;
    const addon = await getAddon(key);
    if (!addon || !addon.active) {
      return NextResponse.json({ success: false, error: "This addon is not available." }, { status: 409 });
    }
    if (addon.pricingModel === "free") {
      return NextResponse.json({ success: false, error: "This addon is free." }, { status: 400 });
    }

    const state = await getEntitlementState(tenantId, key);
    let description = `${addon.name} addon`;
    if (addon.pricingModel === "one_time") {
      // Already covered. Charging again for something they have would be the kind of
      // bug that costs a refund and a support thread.
      if (state.entitled) {
        return NextResponse.json({ success: false, error: "You already have this addon." }, { status: 409 });
      }
    } else {
      if (state.entitled && state.reason !== "purchased" && state.reason !== "in-grace") {
        // Free for everyone, or bundled with their plan: nothing to buy.
        return NextResponse.json({ success: false, error: "You already have this addon." }, { status: 409 });
      }
      const entitlement = (
        await adminDb.collection(TENANT_COLLECTIONS.entitlements(tenantId)).doc(key).get()
      ).data();
      const paidThrough = entitlement?.currentPeriodEnd?.toDate?.() ?? null;
      const period = quoteAddonPeriod({
        now: new Date(),
        paidThrough,
        interval: addon.billingInterval === "yearly" ? "yearly" : "monthly",
      });
      if (!period) {
        return NextResponse.json(
          { success: false, error: "This addon is already paid for. You can renew it in the last week of the period." },
          { status: 409 }
        );
      }
      description = `${addon.name} addon, ${formatDay(period.from)} to ${formatDay(period.to)}`;
    }

    const started = await startBillingCharge({
      kind: "addon",
      tenantId,
      uid: caller.uid,
      email: caller.email,
      addonKey: key,
      priceKobo: addon.amount,
      description,
    });
    if (!started.ok) {
      return NextResponse.json({ success: false, error: started.error }, { status: started.status });
    }
    return NextResponse.json({
      success: true,
      data: { reference: started.reference, checkoutUrl: started.checkoutUrl, amount: started.amountKobo, name: addon.name },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
