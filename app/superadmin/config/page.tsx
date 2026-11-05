import { getPlatformConfig } from "@/lib/platform-config";
import { requireSuperAdmin } from "@/lib/server-auth";
import { PlatformConfigClient } from "@/components/superadmin/platform-config-client";
import { ExpirySweeperCard } from "@/components/superadmin/expiry-sweeper-card";

export const dynamic = "force-dynamic";

export default async function SuperAdminConfigPage() {
  await requireSuperAdmin();

  const config = await getPlatformConfig();

  return (
    <div className="space-y-6">
      <PlatformConfigClient initialConfig={config} />
      <ExpirySweeperCard />
    </div>
  );
}
