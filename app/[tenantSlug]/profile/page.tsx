import { notFound } from "next/navigation";

import { requireTenant } from "@/lib/tenant-context";
import { tenantUrl } from "@/lib/tenant-url";
import { AccountEmailCard } from "@/components/auth/account-email-card";
import { EmailVerificationNotice } from "@/components/auth/email-verification-notice";
import { PageContent } from "@/components/system/page-content";
import { PageHeader } from "@/components/system/page-header";
import { CustomerProfileGuard } from "@/components/tenant/customer-profile-guard";

/**
 * A customer's account page, which did not exist before.
 *
 * It holds exactly one thing today: their email address and the ability to
 * correct it. That is the whole reason it exists - verification without a way
 * to change a wrong address is a dead end, and a customer who typed
 * `gmial.com` at signup previously had no route back at all.
 *
 * Tenant-scoped rather than global because a customer arrives here through a
 * particular venue's portal, and every other page they see is.
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

  const profileHref = tenantUrl(tenant.slug, "/profile");

  return (
    <PageContent width="prose" className="space-y-6 py-6">
      <PageHeader
        title="Your account"
        description={`How ${tenant.businessName} reaches you`}
      />

      {/* Signed-out visitors get sent to sign in rather than an empty page:
          there is nothing here that means anything without an account. */}
      <CustomerProfileGuard>
        <EmailVerificationNotice audience="customer" settingsHref={profileHref} />

        <AccountEmailCard description="Your voucher details are sent here, and it is how you sign in." />
      </CustomerProfileGuard>
    </PageContent>
  );
}
