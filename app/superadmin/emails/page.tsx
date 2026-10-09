import { requireSuperAdmin } from "@/lib/server-auth";
import { EMAIL_CATALOG } from "@/lib/email-catalog";
import { getEmailTemplates } from "@/lib/email-templates";
import { getEmailSettings } from "@/lib/email-settings";
import { isMailtrapConfigured } from "@/lib/mailtrap";
import { EmailTemplatesClient } from "@/components/superadmin/email-templates-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminEmailsPage() {
  await requireSuperAdmin();

  const [settings, emailSettings] = await Promise.all([
    getEmailTemplates(),
    getEmailSettings(),
  ]);

  return (
    <div className="space-y-6">
      <EmailTemplatesClient
        catalog={EMAIL_CATALOG}
        initialSettings={settings}
        initialEmailSettings={emailSettings}
        mailtrapConfigured={isMailtrapConfigured()}
      />
    </div>
  );
}
