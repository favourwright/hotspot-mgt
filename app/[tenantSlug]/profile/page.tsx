import { notFound } from "next/navigation";

import { requireTenant } from "@/lib/tenant-context";
import { CustomerProfileClient } from "@/components/tenant/customer-profile-client";

/**
 * A customer's account page, which did not exist before.
 *
 * Thin by design: who is signed in is only knowable on the client here - auth
 * persists per origin and this renders on a tenant subdomain - so the page
 * resolves the tenant and hands off. Same shape as `/my-vouchers`.
 */
export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  return (
    <CustomerProfileClient
      tenantSlug={tenant.slug}
      businessName={tenant.businessName}
    />
  );
}
