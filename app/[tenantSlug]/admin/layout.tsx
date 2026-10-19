import { AdminShell } from "@/components/tenant/admin-shell";
import { AdminNotices } from "@/components/tenant/admin-notices";

/**
 * A server component solely so the notice region can be one.
 *
 * Everything that used to be here - the auth guard, the nav, the shell - is
 * unchanged in `AdminShell`, which is still a client component because the
 * redirects it performs depend on the live auth store. What moved is the
 * ability to fetch: `AdminNotices` reads the plan-fee state with
 * firebase-admin, which a client layout could never have done, and which is
 * why that notice previously existed on one route only.
 *
 * No auth check here, deliberately. This runs for every admin route and the
 * real gate is `requireTenantOwner` inside each page, which must run before
 * any tenant data is fetched - a check here would be a second, weaker copy
 * that is easy to assume is the one doing the work. `AdminNotices` makes its
 * own ownership check for the same reason, because it fetches.
 */
export default async function TenantAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  return (
    <AdminShell
      tenantSlug={tenantSlug}
      notices={<AdminNotices tenantSlug={tenantSlug} />}
    >
      {children}
    </AdminShell>
  );
}
