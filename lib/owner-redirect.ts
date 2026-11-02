import { auth } from "@/lib/firebase";
import { fetchAccountSummary } from "@/lib/account-client";

/**
 * Resolves an owner's tenant slug so sign-in can land on their dashboard
 * rather than the public landing page - the same directness superadmins
 * get from `/superadmin`.
 *
 * Returns the slug rather than a path: the dashboard lives on the tenant's
 * own subdomain, so only the caller knows whether that is a client-side
 * navigation or a full page load (see lib/tenant-url.ts).
 *
 * Claims carry `tenantId` but not the slug, so this costs one request, only
 * on an owner's sign-in. Returns `null` on any failure: a missing slug should
 * drop the user on `/`, never block a sign-in that already succeeded.
 */
export async function resolveOwnerTenantSlug(): Promise<string | null> {
  const user = auth?.currentUser;
  if (!user) return null;

  try {
    const account = await fetchAccountSummary(await user.getIdToken());
    return account?.tenant?.slug ?? null;
  } catch (err) {
    console.error("Could not resolve tenant slug for redirect:", err);
    return null;
  }
}
