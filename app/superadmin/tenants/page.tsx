import { getAllTenants } from "@/lib/firestore-helpers";
import { TenantsClient } from "@/components/superadmin/tenants-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminTenantsPage() {
  const tenants = await getAllTenants();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Tenants</h1>
        <p className="text-muted-foreground">Manage all platform tenants</p>
      </div>

      <TenantsClient initialTenants={tenants} />
    </div>
  );
}
