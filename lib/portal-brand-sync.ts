/**
 * Keeps the router-rendered portal pages (every file in `routerPortalPages`:
 * the redirect and error pages, `alogin.html`, `status.html`) and the
 * `brand.json` they read in step with the tenant's branding and with the
 * page builders.
 *
 * Written by the install route, and afterwards by router-health
 * (lib/cron-jobs.ts) **only when something changed**. Each location
 * records the key it was last written with in `portalBrandSynced`; a pass
 * whose key matches costs nothing on the router. The key moves when:
 *
 *  - the owner saves new branding (`TenantBranding.version`);
 *  - the tenant moves to or from a plan with custom branding, which flips the branding between
 *    the saved one and none;
 *  - `PORTAL_PAGES_VERSION` is bumped, which is how a change to the page
 *    builders reaches every installed portal without a reinstall. A
 *    location installed before this existed has no key at all, so its
 *    pages are rewritten once, on the first pass after deploy.
 *
 * The pages and brand.json are always written together, because pages
 * from before brand.json existed would never read it.
 */

import { writePortalFile, type RouterConfig } from "@/lib/mikrotik";
import { PORTAL_PAGES_VERSION, routerPortalPages } from "@/lib/hotspot-portal";
import { BRAND_FILE, buildBrandFile, type EffectiveBranding } from "@/lib/branding";

/**
 * The name at the top of the router pages. The same fallback the install
 * route has always used, so a sync never renames a page an install wrote.
 */
export function portalBrandName(data: { businessName?: unknown; slug?: unknown }): string {
  return (
    (typeof data.businessName === "string" && data.businessName) ||
    (typeof data.slug === "string" && data.slug) ||
    ""
  );
}

export function brandSyncKey(
  branding: EffectiveBranding | null,
  version: number
): string {
  return `p${PORTAL_PAGES_VERSION}:b${branding ? version : 0}`;
}

/**
 * Write brand.json and every router page into one portal directory. Reports each file that
 * failed, so the caller can decide whether to record the key: a partial
 * write must not be marked done, or the next pass would skip it.
 */
export async function writePortalBrand(
  config: RouterConfig,
  directory: string,
  values: { brandName: string; branding: EffectiveBranding | null }
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  // brand.json first, so a freshly rewritten page never loads before the
  // file it reads is there.
  const files: Array<[string, string]> = [
    [BRAND_FILE, buildBrandFile(values.branding)],
    ...routerPortalPages({ brandName: values.brandName }),
  ];
  for (const [filename, contents] of files) {
    const written = await writePortalFile(config, directory, filename, contents);
    if (!written.success) errors.push(`${filename}: ${written.error}`);
  }

  return { success: errors.length === 0, errors };
}
