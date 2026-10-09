/**
 * The one function the rest of the app calls to send mail.
 *
 * Three rules hold everywhere this is used, and they are the reason it looks
 * the way it does:
 *
 * 1. **It never throws.** Every call site is downstream of something that has
 *    already succeeded - a payment that cleared, a tenant that was created, a
 *    webhook Paystack expects a 200 from. An email provider having a bad day
 *    must never turn any of those into an error.
 * 2. **An unconfigured template is a skip, not a failure.** Until a superadmin
 *    pastes a Mailtrap template ID in at /superadmin/emails, the email simply
 *    does not send. Nothing half-sends and no blank mail goes out.
 * 3. **It is awaited, not fired and forgotten.** Next.js route handlers can be
 *    torn down the moment the response is returned, which silently drops a
 *    floating promise. The cost is one HTTP round-trip on a path that has
 *    already done several.
 */

import {
  getEmailDefinition,
  type EmailKey,
} from "@/lib/email-catalog";
import { getEmailTemplates } from "@/lib/email-templates";
import { isMailtrapConfigured, sendMailtrapTemplate } from "@/lib/mailtrap";

export type EmailSendOutcome =
  | { sent: true; messageIds?: string[] }
  | { sent: false; reason: EmailSkipReason; detail?: string };

export type EmailSkipReason =
  | "no-recipient"
  | "not-configured"
  | "disabled"
  | "transport-unconfigured"
  | "send-failed";

export interface SendEmailOptions {
  to: string | null | undefined;
  variables?: Record<string, unknown>;
}

export async function sendEmail(
  key: EmailKey,
  { to, variables = {} }: SendEmailOptions
): Promise<EmailSendOutcome> {
  const definition = getEmailDefinition(key);

  if (!to || !to.includes("@")) {
    console.warn(`[email] ${key}: no usable recipient, skipped`);
    return { sent: false, reason: "no-recipient" };
  }

  try {
    const templates = await getEmailTemplates();
    const setting = templates[key];

    if (!setting?.enabled) {
      console.warn(`[email] ${key}: switched off at /superadmin/emails, skipped`);
      return { sent: false, reason: "disabled" };
    }

    if (!setting.templateId) {
      console.warn(
        `[email] ${key}: no Mailtrap template configured, skipped (set one at /superadmin/emails)`
      );
      return { sent: false, reason: "not-configured" };
    }

    if (!isMailtrapConfigured()) {
      console.error(
        `[email] ${key}: Mailtrap credentials missing, skipped`
      );
      return { sent: false, reason: "transport-unconfigured" };
    }

    const result = await sendMailtrapTemplate({
      to,
      templateUuid: setting.templateId,
      variables: withDefaults(variables),
    });

    if (!result.success) {
      console.error(`[email] ${key}: send failed - ${result.error}`);
      return { sent: false, reason: "send-failed", detail: result.error };
    }

    // Logged on success too, deliberately. Without this line an email that
    // sent and an email that was never attempted look identical in the
    // journal, which is exactly the ambiguity that made "I got no email"
    // impossible to answer from the logs alone.
    console.info(`[email] ${key}: sent to ${to}`);
    return { sent: true, messageIds: result.messageIds };
  } catch (error) {
    // Rule 1. Nothing above this line is allowed to reach the caller.
    console.error(
      `[email] ${key}: unexpected error while sending`,
      error,
      definition ? `(${definition.name})` : ""
    );
    return {
      sent: false,
      reason: "send-failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Variables every template can rely on without the call site passing them.
 */
function withDefaults(
  variables: Record<string, unknown>
): Record<string, unknown> {
  return {
    app_url: process.env.NEXT_PUBLIC_APP_URL || "",
    support_email: platformEmail() || "",
    year: String(new Date().getFullYear()),
    ...variables,
  };
}

/**
 * Where `platform.*` emails go. Same env var that decides who the superadmin
 * is at registration, so there is only ever one answer to "who runs this".
 */
export function platformEmail(): string | null {
  const value = (
    process.env.PLATFORM_ALERT_EMAIL ||
    process.env.SUPERADMIN_EMAIL ||
    process.env.ADMIN_EMAIL ||
    ""
  )
    .trim()
    .toLowerCase();
  return value || null;
}

/**
 * An absolute URL for use in an email. `tenantUrl()` returns a bare path on a
 * deployment with no root domain, which is useless in an inbox.
 */
export function absoluteUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!base) return pathOrUrl;
  return `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
