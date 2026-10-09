import { requireSuperAdmin } from "@/lib/server-auth";
import { EMAIL_CATALOG } from "@/lib/email-catalog";
import { getEmailTemplates } from "@/lib/email-templates";
import { isMailtrapConfigured } from "@/lib/mailtrap";
import { EmailTemplatesClient } from "@/components/superadmin/email-templates-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminEmailsPage() {
  await requireSuperAdmin();

  const settings = await getEmailTemplates();

  return (
    <div className="space-y-6">
      <EmailTemplatesClient
        catalog={EMAIL_CATALOG}
        initialSettings={settings}
        mailtrapConfigured={isMailtrapConfigured()}
      />
    </div>
  );
}
