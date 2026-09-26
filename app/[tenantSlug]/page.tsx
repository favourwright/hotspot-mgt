import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { parsePlans, parseLocations } from "@/lib/firestore-helpers";
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

  const [plansSnapshot, locationsSnapshot] = await Promise.all([
    adminDb
      .collection(TENANT_COLLECTIONS.plans(tenant.id))
      .where("active", "==", true)
      .get(),
    adminDb
      .collection(TENANT_COLLECTIONS.locations(tenant.id))
      .where("active", "==", true)
      .get(),
  ]);

  const plans = parsePlans(plansSnapshot.docs);
  const locations = parseLocations(locationsSnapshot.docs);

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
    />
  );
}
