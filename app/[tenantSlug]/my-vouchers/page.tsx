import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { TenantVouchersClient } from "@/components/tenant/vouchers-client";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { tenantUrl } from "@/lib/tenant-url";

interface TenantVouchersPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function TenantVouchersPage({
  params,
}: TenantVouchersPageProps) {
  const { tenantSlug } = await params;

  let tenant;
  try {
    tenant = await requireTenant(tenantSlug);
  } catch {
    notFound();
  }

  return (
    <>
      {/*
        The one page where a wrong address actually costs the customer
        something: these vouchers were emailed to it. Renders nothing for a
        confirmed address or a signed-out visitor.
      */}
      <div className="mb-6">
        <EmailVerificationNotice
          audience="customer"
          settingsHref={tenantUrl(tenant.slug, "/profile")}
        />
      </div>
      <TenantVouchersClient
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
        businessName={tenant.businessName}
      />
    </>
  );
}
