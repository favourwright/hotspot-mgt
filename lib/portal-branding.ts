/**
 * Whether a tenant may brand their captive portal, and what the portal is
 * actually shown.
 *
 * Custom branding is a **plan feature**, `BillingPlan.features.customBranding`,
 * switched on per plan in the billing-plan dialog and listed on plan cards.
 * For a long time that switch was checked nowhere; this file is the check.
 *
 * Branding is saved whatever the plan and decided at display time, so a
 * tenant who moves to a plan without it and back again gets the same logo
 * back without uploading it again. Not having it falls back to the default
 * look; it never blocks a page. Losing a logo is cosmetic, and failing
 * closed the way the captive-portal paywall does would turn a plan change
 * into an outage.
 *
 * Costs no Firestore reads on the busy path: the plan comes from the
 * cached lookup in lib/billing-plans.ts, and a tenant with nothing saved,
 * which is almost all of them, skips even that.
 */

import { getBillingPlanById } from "@/lib/billing-plans";
import { normalizeAccentColor, type EffectiveBranding } from "@/lib/branding";
import type { TenantBranding } from "@/types/schemas";

export function hasSavedBranding(branding: TenantBranding | null | undefined): boolean {
  return Boolean(branding?.logo || branding?.accentColor);
}

/** Whether this plan includes custom branding. False for no plan at all. */
export async function planIncludesBranding(
  planId: string | null | undefined
): Promise<boolean> {
  if (!planId) return false;
  const plan = await getBillingPlanById(planId);
  return plan?.features.customBranding ?? false;
}

export async function getPortalBranding(
  planId: string | null | undefined,
  branding: TenantBranding | null | undefined
): Promise<EffectiveBranding | null> {
  if (!branding || !hasSavedBranding(branding)) return null;
  if (!(await planIncludesBranding(planId))) return null;
  return {
    logo: branding.logo,
    accentColor: normalizeAccentColor(branding.accentColor),
  };
}
