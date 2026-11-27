import { requireSuperAdmin } from "@/lib/server-auth";
import { EMAIL_CATALOG } from "@/lib/email-catalog";
import { getEmailSwitches } from "@/lib/email-switches";
import { getEmailSettings } from "@/lib/email-settings";
import { isMailtrapConfigured } from "@/lib/mailtrap";
import { EmailsClient } from "@/components/superadmin/emails-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminEmailsPage() {
  await requireSuperAdmin();

  const [switches, emailSettings] = await Promise.all([
    getEmailSwitches(),
    getEmailSettings(),
  ]);

  return (
    <div className="space-y-6">
      <EmailsClient
        catalog={EMAIL_CATALOG}
        initialSwitches={switches}
        initialEmailSettings={emailSettings}
        mailtrapConfigured={isMailtrapConfigured()}
      />
    </div>
  );
}
