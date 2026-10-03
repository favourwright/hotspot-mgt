import { getAllTenants } from "@/lib/firestore-helpers";
import { requireSuperAdmin } from "@/lib/server-auth";
import { TenantsClient } from "@/components/superadmin/tenants-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminTenantsPage() {
  await requireSuperAdmin();

  const tenants = await getAllTenants();

  return (
    <div className="space-y-6">
      <TenantsClient initialTenants={tenants} />
    </div>
  );
}
