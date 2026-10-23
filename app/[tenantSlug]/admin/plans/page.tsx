import { requireTenantOwner } from "@/lib/tenant-context";
import { getTenantPlans, getTenantLocations } from "@/lib/firestore-helpers";
import { getServerUser } from "@/lib/server-auth";
import { PlansTable } from "@/components/admin/plans-table";
import { RenewalSettings } from "@/components/admin/renewal-settings";

export default async function TenantPlansPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const tenant = await requireTenantOwner(tenantSlug);

  const [plans, locations] = await Promise.all([
    getTenantPlans(tenant.id),
    getTenantLocations(tenant.id),
  ]);

  // A superadmin viewing this page sees the settings and no Save button. The
  // API behind it is owner-only regardless; this just stops offering an
  // action that would be refused, exactly as on the settings page.
  const viewer = await getServerUser();
  const isOwner = viewer?.role === "owner" && viewer.tenantId === tenant.id;

  return (
    <div className="space-y-6">
      <PlansTable
        initialPlans={plans}
        initialLocations={locations}
        tenantSlug={tenantSlug}
      />

      {/*
        Read straight off the tenant document this page already loaded,
        which is also how fulfilment and the checkout preview get them -
        there is no endpoint to read them back.
      */}
      <RenewalSettings
        initial={{
          renewalExpiryMode: tenant.renewalExpiryMode,
          renewalDataMode: tenant.renewalDataMode,
        }}
        canEdit={isOwner}
      />
    </div>
  );
}
