import { getAllTenants } from "@/lib/firestore-helpers";
import { getCachedPlatformStats } from "@/lib/stats-cache";
import { requireSuperAdmin } from "@/lib/server-auth";
import { SuperAdminStatsCards } from "@/components/superadmin/stats-cards";
import { RecentTenantsTable } from "@/components/superadmin/recent-tenants-table";
import { PageHeader } from "@/components/system/page-header";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  await requireSuperAdmin();

  const [stats, recentTenants] = await Promise.all([
    getCachedPlatformStats(),
    getAllTenants({ limit: 5 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="All tenants and platform metrics"
      />

      <SuperAdminStatsCards stats={stats} />

      <RecentTenantsTable tenants={recentTenants} />
    </div>
  );
}
