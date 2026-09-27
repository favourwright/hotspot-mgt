import { getPlatformStats, getAllTenants } from "@/lib/firestore-helpers";
import { SuperAdminStatsCards } from "@/components/superadmin/stats-cards";
import { RecentTenantsTable } from "@/components/superadmin/recent-tenants-table";

export const dynamic = "force-dynamic";

export default async function SuperAdminPage() {
  const [stats, recentTenants] = await Promise.all([
    getPlatformStats(),
    getAllTenants({ limit: 5 }),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-muted-foreground">
          All tenants and platform metrics
        </p>
      </div>

      <SuperAdminStatsCards stats={stats} />

      <div>
        <h2 className="text-lg font-semibold mb-4">Recent Tenants</h2>
        <RecentTenantsTable tenants={recentTenants} />
      </div>
    </div>
  );
}
