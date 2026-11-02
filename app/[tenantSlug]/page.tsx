import { notFound } from "next/navigation";
import { getTenant, requireTenant } from "@/lib/tenant-context";
import { indexable } from "@/lib/seo";
import { tenantUrl } from "@/lib/tenant-url";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parseLocations } from "@/lib/firestore-helpers";
import { getCachedActivePlans } from "@/lib/plans-cache";
import { TenantCustomerHome } from "@/components/tenant/customer-home";

interface TenantHomeProps {
  params: Promise<{ tenantSlug: string }>;
}

/**
 * The one tenant page open to search, so a customer can find a business by
 * name. The rest (admin, vouchers, portal, profile) stay `noindex`, as does a
 * suspended tenant, whose page is a 200 saying the service is unavailable.
 */
export async function generateMetadata({ params }: TenantHomeProps) {
  const { tenantSlug } = await params;
  const tenant = await getTenant(tenantSlug);
  if (!tenant || tenant.status === "suspended") return {};

  return {
    title: `${tenant.businessName} - Buy WiFi Vouchers`,
    description: `Buy ${tenant.businessName} WiFi vouchers online and get your login instantly.`,
    ...indexable(tenantUrl(tenant.slug)),
  };
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
