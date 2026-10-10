import { requireSuperAdmin } from "@/lib/server-auth";
import { ADDON_CATALOG, ADDON_KEYS } from "@/lib/addon-catalog";
import { getAllAddons } from "@/lib/addons";
import { AddonsClient } from "@/components/superadmin/addons-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminAddonsPage() {
  await requireSuperAdmin();

  return (
    <div className="space-y-6">
      <AddonsClient
        initialAddons={await getAllAddons()}
        catalog={ADDON_KEYS.map((key) => ({ key, ...ADDON_CATALOG[key] }))}
      />
    </div>
  );
}
