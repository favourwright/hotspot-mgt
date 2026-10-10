import { NextRequest, NextResponse } from "next/server";

import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { ADDON_KEYS } from "@/lib/addon-catalog";
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
      ADDON_KEYS.map((key) => getEntitlementState(tenantId, key))
    );
    const byKey = new Map(states.map((s) => [s.addonKey, s]));

    return NextResponse.json({
      success: true,
      data: addons
        // An addon nobody has and nobody can buy is noise on this page. One
        // already granted still shows, so a tenant can see what they have.
        .filter((addon) => addon.active || byKey.get(addon.key)?.entitled)
        .map((addon) => ({
          key: addon.key,
          name: addon.name,
          description: addon.description,
          pricingModel: addon.pricingModel,
          amount: addon.amount,
          billingInterval: addon.billingInterval,
          entitled: byKey.get(addon.key)?.entitled ?? false,
          reason: byKey.get(addon.key)?.reason ?? "not-purchased",
          status: byKey.get(addon.key)?.status ?? null,
          endsAt: byKey.get(addon.key)?.endsAt?.toISOString() ?? null,
        })),
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
