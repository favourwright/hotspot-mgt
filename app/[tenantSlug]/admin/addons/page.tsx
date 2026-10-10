import { requireTenantOwner } from "@/lib/tenant-context";
import { ADDON_KEYS } from "@/lib/addon-catalog";
import { getAllAddons } from "@/lib/addons";
import { getEntitlementState } from "@/lib/entitlements";
import { AddonsMarketplace } from "@/components/admin/addons-marketplace";

export const dynamic = "force-dynamic";

export default async function TenantAddonsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await requireTenantOwner(tenantSlug);

  const [addons, states] = await Promise.all([
    getAllAddons(),
    Promise.all(ADDON_KEYS.map((key) => getEntitlementState(tenant.id, key))),
  ]);
  const byKey = new Map(states.map((state) => [state.addonKey, state]));

  return (
    <AddonsMarketplace
      ownerEmail={tenant.ownerEmail}
      addons={addons
        .filter((addon) => addon.active || byKey.get(addon.key)?.entitled)
        .map((addon) => ({
          key: addon.key,
          name: addon.name,
          description: addon.description,
          pricingModel: addon.pricingModel,
          amount: addon.amount,
          billingInterval: addon.billingInterval,
          entitled: byKey.get(addon.key)?.entitled ?? false,
          reason: byKey.get(addon.key)?.reason ?? "not-purchased",
          endsAt: byKey.get(addon.key)?.endsAt?.toISOString() ?? null,
        }))}
    />
  );
}
