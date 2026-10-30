import { requireTenantOwner } from "@/lib/tenant-context";
import { getServerUser } from "@/lib/server-auth";
import { hasApiAccess } from "@/lib/api-access";
import { endpointView, listTenantEndpoints } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_TYPES } from "@/lib/webhook-events";
import { WebhooksClient } from "@/components/admin/webhooks-client";

export const dynamic = "force-dynamic";

export default async function TenantWebhooksPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  const [endpoints, entitled, viewer] = await Promise.all([
    listTenantEndpoints(tenant.id),
    hasApiAccess(tenant.id),
    getServerUser(),
  ]);
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

  return (
    <WebhooksClient
      tenantSlug={tenantSlug}
      initialEndpoints={endpoints.map(endpointView)}
      // From the same definitions the deliveries are built from, so the
      // page cannot list an event that does not exist.
      eventTypes={WEBHOOK_EVENT_TYPES.map((type) => ({ type, description: WEBHOOK_EVENTS[type].description }))}
      entitled={entitled}
      canEdit={isOwner}
    />
  );
}
