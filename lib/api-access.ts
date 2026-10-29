/**
 * The gate for every developer-facing feature: decision hooks today, API
 * keys and outbound webhooks as they ship (docs/plans/tenant-api-and-hooks.md).
 *
 * It is `BillingPlan.features.apiAccess`, the "API access" switch in the
 * superadmin billing-plan dialog, and not an addon. A tenant gets it by being
 * on a plan that includes it, the same way the onboarding plan cards already
 * advertise it. One switch for the whole family, so a plan that offers "API
 * access" offers all of it, and nothing is sold separately.
 *
 * Before this, `apiAccess` was editable and advertised but checked nowhere
 * (docs/addons.md recorded it as exactly that). This is the check.
 *
 * Read through the tenant and billing-plan caches, so it costs no Firestore
 * read on a warm path. A plan edit invalidates the plan cache, so switching
 * the feature off on a plan applies on the next request.
 */

import { getTenantDocById } from "@/lib/tenant-cache";
import { getBillingPlanById } from "@/lib/billing-plans";

export class ApiAccessRequiredError extends Error {
  constructor() {
    super("API access is not included in this tenant's plan.");
    this.name = "ApiAccessRequiredError";
  }
}

export async function hasApiAccess(tenantId: string): Promise<boolean> {
  const planId = (await getTenantDocById(tenantId))?.planId;
  if (typeof planId !== "string" || !planId) return false;
  const plan = await getBillingPlanById(planId);
  return plan?.features.apiAccess === true;
}

/**
 * Throws `ApiAccessRequiredError` unless the tenant's plan includes API
 * access. Call it after authentication and before any side effect.
 */
export async function requireApiAccess(tenantId: string): Promise<void> {
  if (!(await hasApiAccess(tenantId))) throw new ApiAccessRequiredError();
}
