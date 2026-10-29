/**
 * The gate for every developer-facing feature: decision hooks today, API
 * keys and outbound webhooks as they ship (docs/plans/tenant-api-and-hooks.md).
 *
 * It is the `api-access` addon, resolved the way every addon is
 * (lib/entitlements.ts): entitled if the addon is free, if the tenant's plan
 * bundles it (`includedAddons`), or if the tenant bought it from the Addons
 * page. One addon for the whole family, so "API access" means all of it.
 *
 * This replaced `BillingPlan.features.apiAccess`, a switch the billing-plan
 * dialog offered and the plan cards advertised but nothing ever checked.
 * Plans that should include it now bundle the addon instead.
 *
 * An addon with no Firestore document resolves to not-entitled for
 * everyone, bundled or not, so nothing unlocks until a superadmin sets the
 * addon up at /superadmin/addons.
 */

import { hasAddon } from "@/lib/entitlements";
import { API_ACCESS_ADDON } from "@/lib/addon-catalog";

export class ApiAccessRequiredError extends Error {
  constructor() {
    super("This tenant does not have the API Access addon.");
    this.name = "ApiAccessRequiredError";
  }
}

export async function hasApiAccess(tenantId: string): Promise<boolean> {
  return hasAddon(tenantId, API_ACCESS_ADDON);
}

/**
 * Throws `ApiAccessRequiredError` unless the tenant is entitled to the API
 * Access addon. Call it after authentication and before any side effect.
 */
export async function requireApiAccess(tenantId: string): Promise<void> {
  if (!(await hasApiAccess(tenantId))) throw new ApiAccessRequiredError();
}
