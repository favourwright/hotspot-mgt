import { after } from "next/server";
import { requireTenantOwner } from "@/lib/tenant-context";
import { syncTenantHookGardenLater } from "@/lib/hook-walled-garden";
import { getTenantLocations, getTenantPlans } from "@/lib/firestore-helpers";
import { getServerUser } from "@/lib/server-auth";
import { hasApiAccess } from "@/lib/api-access";
import { hookSecretsConfigured } from "@/lib/hook-secrets";
import { hookView, listTenantHooks } from "@/lib/decision-hooks";
import { HooksClient } from "@/components/admin/hooks-client";

export const dynamic = "force-dynamic";

export default async function TenantHooksPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  const [hooks, plans, locations, entitled, viewer] = await Promise.all([
    listTenantHooks(tenant.id),
    getTenantPlans(tenant.id),
    getTenantLocations(tenant.id),
    hasApiAccess(tenant.id),
    getServerUser(),
  ]);

  // A verification page that has never been put through the walled garden
  // (a hook saved before that existed): do it now, so the card's status line
  // becomes true by the next refresh rather than at the next save.
  if (hooks.some((h) => h.linkUrl && !h.walledGardenSync)) {
    syncTenantHookGardenLater(tenant.id, after);
  }

  // A superadmin viewing this page sees it read-only; the routes behind it
  // are owner-only regardless.
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

  return (
    <HooksClient
      tenantSlug={tenantSlug}
      initialHooks={hooks.map(hookView)}
      plans={plans.map((p) => ({ id: p.id, name: p.name, locationName: p.locationName }))}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      entitled={entitled}
      configured={hookSecretsConfigured()}
      canEdit={isOwner}
    />
  );
}
