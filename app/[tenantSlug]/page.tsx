import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseLocations } from "@/lib/firestore-helpers";
import { getCachedActivePlans } from "@/lib/plans-cache";
import { TenantCustomerHome } from "@/components/tenant/customer-home";

interface TenantHomeProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantHomePage({ params }: TenantHomeProps) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  const [plans, locationsSnapshot] = await Promise.all([
    // Cached per tenant - this is a per-visitor read on a public page.
    getCachedActivePlans(tenant.id),
    adminDb
      .collection(TENANT_COLLECTIONS.locations(tenant.id))
      .where("active", "==", true)
      .get(),
  ]);

  const locations = parseLocations(locationsSnapshot.docs);

  return (
    <TenantCustomerHome
      tenant={{
        id: tenant.id,
        slug: tenant.slug,
        businessName: tenant.businessName,
      }}
      plans={plans}
      locations={locations}
    />
  );
}
