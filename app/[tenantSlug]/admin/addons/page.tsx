import { requireTenantOwner } from "@/lib/tenant-context";
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

  // Every addon, not only the sellable ones: a tenant who holds one that has
  // since been withdrawn still needs to see that they have it.
  const addons = await getAllAddons();
  const states = await Promise.all(
    addons.map((addon) => getEntitlementState(tenant.id, addon.key))
  );

  return (
    <AddonsMarketplace
      addons={addons
        .map((addon, index) => ({ addon, state: states[index] }))
        .filter(({ addon, state }) => addon.active || state.entitled)
        .map(({ addon, state }) => ({
          key: addon.key,
          name: addon.name,
          description: addon.description,
          pricingModel: addon.pricingModel,
          amount: addon.amount,
          billingInterval: addon.billingInterval,
          entitled: state.entitled,
          reason: state.reason,
          endsAt: state.endsAt?.toISOString() ?? null,
          // Withdrawn from sale but still held: no buy button for it.
          purchasable: addon.active,
        }))}
    />
  );
}
