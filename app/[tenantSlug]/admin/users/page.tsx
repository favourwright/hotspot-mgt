import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantLocations } from "@/lib/firestore-helpers";
import { HotspotUsersClient } from "@/components/admin/hotspot-users-client";

export default async function TenantUsersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  // Only the location list is fetched server-side. Everything that touches a
  // router is loaded from the client, so a slow or unreachable router can
  // never hold up this page's first paint.
  const locations = await getTenantLocations(tenant.id);

  return (
    <HotspotUsersClient
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
    />
  );
}
