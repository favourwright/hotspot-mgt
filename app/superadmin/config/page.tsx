import { getPlatformConfig } from "@/lib/platform-config";
import { requireSuperAdmin } from "@/lib/server-auth";
import { PlatformConfigClient } from "@/components/superadmin/platform-config-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminConfigPage() {
  await requireSuperAdmin();

  const config = await getPlatformConfig();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Platform Config</h1>
        <p className="text-muted-foreground">
          WireGuard settings and Paystack fee defaults — billing plans now
          live under Billing Plans
        </p>
      </div>

      <PlatformConfigClient initialConfig={config} />
    </div>
  );
}
