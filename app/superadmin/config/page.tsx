import { getPlatformConfig } from "@/lib/platform-config";
import { requireSuperAdmin } from "@/lib/server-auth";
import { PlatformConfigClient } from "@/components/superadmin/platform-config-client";
import { PageHeader } from "@/components/system/page-header";

export const dynamic = "force-dynamic";

export default async function SuperAdminConfigPage() {
  await requireSuperAdmin();

  const config = await getPlatformConfig();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform config"
        description="WireGuard settings and Paystack fee defaults — billing plans now live under Billing plans"
      />

      <PlatformConfigClient initialConfig={config} />
    </div>
  );
}
