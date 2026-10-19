import { NextRequest, NextResponse } from "next/server";

import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { getAddon, getEntitlementState } from "@/lib/entitlements";
import { isAddonKey } from "@/lib/addon-catalog";
import { ensureAddonPlanCode } from "@/lib/addons";

export const dynamic = "force-dynamic";

/**
 * What the browser needs to open the Paystack popup for an addon.
 *
 * Returns the amount and, for a subscription, the Plan code. Nothing here is
 * an entitlement: paying is a separate step and activation re-verifies
 * everything from scratch, so a tenant who calls this and then lies about the
 * outcome gets nothing.
 *
 * The amount is computed server-side rather than echoed from the client for
 * the usual reason: the activate route compares the charge against the
 * addon's live price, and a client-chosen amount would simply fail there.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await requireUnlockedOwner(authHeader);
    const { key } = await params;

    const addon = await getAddon(key);
    if (!addon || !addon.active) {
      return NextResponse.json(
        { success: false, error: "This addon is not available." },
        { status: 409 }
      );
    }

    if (addon.pricingModel === "free") {
      return NextResponse.json(
        { success: false, error: "This addon is free." },
        { status: 400 }
      );
    }

    // Already covered. Charging again for something they have would be the
    // kind of bug that costs a refund and a support thread.
    const state = await getEntitlementState(tenantId, key);
    if (state.entitled && state.reason !== "in-grace") {
      return NextResponse.json(
        { success: false, error: "You already have this addon." },
        { status: 409 }
      );
    }

    // isAddonKey rather than a cast: the catalog is the list of addons that
    // exist at all, so a key outside it has no Paystack Plan to prepare.
    const planCode =
      addon.pricingModel === "subscription" && isAddonKey(key)
        ? await ensureAddonPlanCode(key)
        : null;

    return NextResponse.json({
      success: true,
      data: { planCode, amount: addon.amount, name: addon.name },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
