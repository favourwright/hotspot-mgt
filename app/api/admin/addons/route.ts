import { NextRequest, NextResponse } from "next/server";

import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { getAllAddons } from "@/lib/addons";
import { getEntitlementState } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

/**
 * The addons this tenant can see, each with where they stand on it.
 *
 * `entitled` here is for rendering only. Every gate re-resolves entitlement
 * server-side at the point of use, so a tampered response buys nothing but a
 * button that fails.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const addons = await getAllAddons();
    const states = await Promise.all(
      addons.map((addon) => getEntitlementState(tenantId, addon.key))
    );

    return NextResponse.json({
      success: true,
      data: addons
        .map((addon, index) => ({ addon, state: states[index] }))
        // An addon nobody has and nobody can buy is noise. One already held
        // still shows, so a tenant can see what they have.
        .filter(({ addon, state }) => addon.active || state.entitled)
        .map(({ addon, state }) => ({
          key: addon.key,
          name: addon.name,
          description: addon.description,
          pricingModel: addon.pricingModel,
          amount: addon.amount,
          billingInterval: addon.billingInterval,
          entitled: state.entitled,
          reason: state.reason,
          status: state.status,
          endsAt: state.endsAt?.toISOString() ?? null,
          purchasable: addon.active,
        })),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
