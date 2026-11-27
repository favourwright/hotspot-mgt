import { AdminShell } from "@/components/tenant/admin-shell";
import { AdminNotices } from "@/components/tenant/admin-notices";
import { getTenant } from "@/lib/tenant-context";
import { getServerUser } from "@/lib/server-auth";
import { getTenantFleet } from "@/lib/tenant-fleet";

/**
 * Whether the tenant has finished setup, which picks the nav's main items
 * (`components/tenant/admin-nav.tsx`).
 *
 * It checks ownership itself, the way `AdminNotices` does, because it
 * fetches tenant data and this layout renders for anyone who requests the
 * URL. This check gates only that one boolean and is not the page gate;
 * anyone it refuses gets the setup nav, which they never see because
 * `AdminShell` renders nothing for them.
 */
async function resolveSetupComplete(tenantSlug: string): Promise<boolean> {
  const [tenant, user] = await Promise.all([getTenant(tenantSlug), getServerUser()]);
  if (!tenant || !user) return false;
  const allowed =
    user.role === "superadmin" || (user.role === "owner" && user.tenantId === tenant.id);
  if (!allowed) return false;
  return (await getTenantFleet(tenant.id)).setupComplete;
}

/**
 * A server component so the notice region, and the setup state the nav
 * reads, can be fetched on the server.
 *
 * Everything that used to be here - the auth guard, the nav, the shell - is
 * unchanged in `AdminShell`, which is still a client component because the
 * redirects it performs depend on the live auth store. What moved is the
 * ability to fetch: `AdminNotices` reads the plan-fee state with
 * firebase-admin, which a client layout could never have done, and which is
 * why that notice previously existed on one route only.
 *
 * No page gate here, deliberately. This runs for every admin route and the
 * real gate is `requireTenantOwner` inside each page, which must run before
 * any tenant data is fetched - a gate here would be a second, weaker copy
 * that is easy to assume is the one doing the work. `AdminNotices` and
 * `resolveSetupComplete` each make their own ownership check because they
 * fetch.
 */
export default async function TenantAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const setupComplete = await resolveSetupComplete(tenantSlug);

  return (
    <AdminShell
      tenantSlug={tenantSlug}
      setupComplete={setupComplete}
      notices={<AdminNotices tenantSlug={tenantSlug} />}
    >
      {children}
    </AdminShell>
  );
}
