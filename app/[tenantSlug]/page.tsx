import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseLocations } from "@/lib/firestore-helpers";
import { getCachedActivePlans } from "@/lib/plans-cache";
import { TenantCustomerHome } from "@/components/tenant/customer-home";
import { resolvePaystackBearer } from "@/lib/billing-plans";

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

  // Resolved here rather than fetched from the browser: this depends on the
  // tenant's plan, and /api/platform/config only knows the platform-wide
  // default. The portal resolves the same value the same way.
  const paystackBearer = await resolvePaystackBearer(tenant.planId);

  return (
    <TenantCustomerHome
      tenant={{
        id: tenant.id,
        slug: tenant.slug,
        businessName: tenant.businessName,
        paystackSubaccountCode: tenant.paystackSubaccountCode,
      }}
      plans={plans}
      locations={locations}
      paystackBearer={paystackBearer}
    />
  );
}
