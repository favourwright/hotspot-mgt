import { requireTenantOwner } from "@/lib/tenant-context";
import { getServerUser } from "@/lib/server-auth";
import { hasApiAccess } from "@/lib/api-access";
import { keyView, listTenantKeys } from "@/lib/api-keys";
import { ApiKeysClient } from "@/components/admin/api-keys-client";

export const dynamic = "force-dynamic";

export default async function TenantApiKeysPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  const [keys, entitled, viewer] = await Promise.all([
    listTenantKeys(tenant.id),
    hasApiAccess(tenant.id),
    getServerUser(),
  ]);

  // A superadmin viewing this page sees it read-only; the routes behind it
  // are owner-only regardless.
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

  return (
    <ApiKeysClient
      tenantSlug={tenantSlug}
      initialKeys={keys.map(keyView)}
      entitled={entitled}
      canEdit={isOwner}
    />
  );
}
