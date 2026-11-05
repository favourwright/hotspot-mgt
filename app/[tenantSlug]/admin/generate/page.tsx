import { requireTenantOwner } from "@/lib/tenant-context";
import { getServerUser } from "@/lib/server-auth";
import { VOUCHER_GENERATION_ADDON } from "@/lib/addon-catalog";
import { hasAddon } from "@/lib/entitlements";
import { getTenantLocations, getTenantPlans } from "@/lib/firestore-helpers";
import { getPlatformConfig } from "@/lib/platform-config";
import {
  getCodeFormat,
  getGenerationQuota,
  listBatches,
} from "@/lib/voucher-generation";
import { VoucherGenerationClient } from "@/components/admin/voucher-generation-client";

export const dynamic = "force-dynamic";

export default async function TenantGenerateCodesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  const [quota, format, entitled, config, batches, locations, plans, viewer] =
    await Promise.all([
      getGenerationQuota(tenant.id),
      getCodeFormat(tenant.id),
      hasAddon(tenant.id, VOUCHER_GENERATION_ADDON),
      getPlatformConfig(),
      listBatches(tenant.id),
      getTenantLocations(tenant.id, true),
      getTenantPlans(tenant.id),
      getServerUser(),
    ]);

  // A superadmin viewing this page sees it read-only; the routes behind it
  // are owner-only regardless.
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

  return (
    <VoucherGenerationClient
      tenantSlug={tenantSlug}
      businessName={tenant.businessName}
      canEdit={isOwner}
      entitled={entitled}
      initialQuota={quota}
      initialFormat={format}
      limits={config.voucherGeneration}
      initialBatches={batches}
      locations={locations.map((l) => ({ id: l.id, name: l.name }))}
      plans={plans
        .filter((p) => p.active)
        .map((p) => ({
          id: p.id,
          name: p.name,
          locationId: p.locationId,
          duration: p.duration,
          dataLimit: p.dataLimit ?? null,
          price: p.price,
        }))}
    />
  );
}
