/**
 * Mailtrap transport - the only place in this codebase that talks HTTP to an
 * email provider.
 *
 * Templates live in Mailtrap, not here: this never sends a subject or a body,
 * only a `template_uuid` plus the variables that template is written against.
 * Which UUID goes with which of this app's emails is configured by a
 * superadmin at /superadmin/emails (see `lib/email-templates.ts`).
 *
 * This is the production Sending API (real delivery through a verified
 * sending domain), not the testing sandbox - a wrong token here means mail to
 * real people silently stops, which is why `isMailtrapConfigured()` exists and
 * the superadmin page surfaces it.
 */

const MAILTRAP_SEND_URL = "https://send.api.mailtrap.io/api/send";

export interface MailtrapResult {
  success: boolean;
  messageIds?: string[];
  error?: string;
}

export interface MailtrapSendOptions {
  /**
   * One or more recipients. Several addresses become several entries on a
   * single message rather than several messages: the only emails that go to
   * more than one person are internal operational alerts, where the
   * recipients already know about each other.
   */
  to: string | string[];
  templateUuid: string;
  variables: Record<string, unknown>;
}

function senderConfig() {
  return {
    token: process.env.MAILTRAP_API_TOKEN?.trim() || "",
    email: process.env.MAILTRAP_SENDER_EMAIL?.trim() || "",
    name: process.env.MAILTRAP_SENDER_NAME?.trim() || "OgaWiFi",
  };
}

/**
 * Whether sending can work at all. Checked before every send so a missing
 * token is reported as exactly that, rather than as a 401 from Mailtrap.
 */
export function isMailtrapConfigured(): boolean {
  const { token, email } = senderConfig();
  return Boolean(token && email);
}

export async function sendMailtrapTemplate({
  to,
  templateUuid,
  variables,
}: MailtrapSendOptions): Promise<MailtrapResult> {
  const { token, email, name } = senderConfig();

  if (!token || !email) {
    return {
      success: false,
      error:
        "Mailtrap is not configured - MAILTRAP_API_TOKEN and MAILTRAP_SENDER_EMAIL must both be set",
    };
  }

  try {
    const response = await fetch(MAILTRAP_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Mailtrap accepts either header on the Sending API. Both are sent
        // because its own docs and its SDKs disagree about which is
        // canonical, and an auth failure here is invisible until someone
        // notices mail stopped.
        "Api-Token": token,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        from: { email, name },
        to: (Array.isArray(to) ? to : [to]).map((email) => ({ email })),
        template_uuid: templateUuid,
        // Mailtrap rejects non-string values in some template contexts, and a
        // Firestore Timestamp or a number formats differently than intended
        // anyway - callers are expected to pass display-ready strings.
        template_variables: variables,
        // No `category` here, and no subject/text/html either: Mailtrap
        // rejects the whole request with "'category' is not allowed with
        // 'template_uuid'" if any of them are sent alongside a template. The
        // template owns all of that. Caught by a live test send, not by any
        // amount of reading - the API accepts the field, then 400s on it.
      }),
    });

    const body = (await response.json().catch(() => null)) as {
      success?: boolean;
      message_ids?: string[];
      errors?: string[];
    } | null;

    if (!response.ok || body?.success === false) {
      const detail =
        body?.errors?.join(", ") || `Mailtrap responded ${response.status}`;
      return { success: false, error: detail };
    }

    return { success: true, messageIds: body?.message_ids };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Mailtrap request failed",
    };
  }
}
