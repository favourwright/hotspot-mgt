/**
 * Who email goes to, as opposed to what it looks like.
 *
 * Lives beside the template map in `emailConfig/`, but in its own document:
 * the template map is keyed by email and grows with the catalog, while this
 * is a handful of fields that apply across every send.
 *
 * These were both `PLATFORM_ALERT_EMAIL` once. Moving them into Firestore
 * means adding an address is a form submission rather than an env edit, a
 * rebuild and a restart. The env var survives only as a fallback, so a
 * deployment that has not configured anything yet still alerts somebody.
 */

import { cache } from "react";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import type { EmailSettings } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

const EMAIL_SETTINGS_DOC = "settings";

/** The pre-Firestore behaviour, kept so nothing silently stops alerting. */
function envFallbackAddress(): string | null {
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

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

export const getEmailSettings = cache(async (): Promise<EmailSettings> => {
  const fallback = envFallbackAddress();
  const defaults: EmailSettings = {
    alertRecipients: fallback ? [fallback] : [],
    supportEmail: fallback ?? "",
    updatedAt: null,
  };

  try {
    const doc = await adminDb
      .collection(COLLECTIONS.EMAIL_CONFIG)
      .doc(EMAIL_SETTINGS_DOC)
      .get();

    if (!doc.exists) return defaults;

    const data = doc.data() ?? {};
    const stored = Array.isArray(data.alertRecipients)
      ? data.alertRecipients
          .filter((v: unknown): v is string => typeof v === "string")
          .map((v) => v.trim().toLowerCase())
          .filter((v) => v.includes("@"))
      : [];

    return {
      // An empty saved list falls back rather than meaning "alert nobody".
      // Silently stopping every operational alert is never what an empty
      // form field was meant to express.
      alertRecipients: stored.length > 0 ? stored : defaults.alertRecipients,
      supportEmail:
        typeof data.supportEmail === "string" && data.supportEmail.trim()
          ? data.supportEmail.trim()
          : defaults.supportEmail,
      updatedAt: toDate(data.updatedAt),
    };
  } catch (error) {
    console.error("Failed to read email settings, using fallback:", error);
    return defaults;
  }
});

export async function setEmailSettings(
  updates: Partial<Pick<EmailSettings, "alertRecipients" | "supportEmail">>
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.alertRecipients) {
    // De-duplicated and normalised here rather than at send time, so the
    // stored value is the same thing the admin page shows back.
    payload.alertRecipients = [
      ...new Set(updates.alertRecipients.map((a) => a.trim().toLowerCase())),
    ].filter((a) => a.includes("@"));
  }
  if (typeof updates.supportEmail === "string") {
    payload.supportEmail = updates.supportEmail.trim().toLowerCase();
  }

  await adminDb
    .collection(COLLECTIONS.EMAIL_CONFIG)
    .doc(EMAIL_SETTINGS_DOC)
    .set(payload, { merge: true });
}
