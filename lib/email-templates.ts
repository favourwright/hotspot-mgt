/**
 * The mutable half of the email system: which Mailtrap template each email
 * key uses, and whether it is switched on.
 *
 * One Firestore document (`emailConfig/templates`) holds every entry, so a
 * send costs a single read rather than one per email type. The catalog in
 * `lib/email-catalog.ts` stays the authority on *which* keys exist - anything
 * stored here for a key that is no longer in the catalog is simply ignored on
 * read rather than deleted, so removing an entry from the catalog can never
 * destroy a template ID someone will want back.
 */

import { cache } from "react";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { EMAIL_CATALOG, type EmailKey, isEmailKey } from "@/lib/email-catalog";
import type { EmailTemplateSetting } from "@/types/schemas";
import { Timestamp } from "firebase-admin/firestore";

const EMAIL_CONFIG_DOC = "templates";

export type EmailTemplateMap = Record<EmailKey, EmailTemplateSetting>;

function emptySetting(): EmailTemplateSetting {
  return { templateId: "", enabled: true, updatedAt: null };
}

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Every catalog key, always - unconfigured ones come back with an empty
 * `templateId` rather than being absent, so callers and the admin page never
 * have to distinguish "missing" from "blank".
 */
export const getEmailTemplates = cache(async (): Promise<EmailTemplateMap> => {
  const result = {} as EmailTemplateMap;
  for (const entry of EMAIL_CATALOG) {
    result[entry.key] = emptySetting();
  }

  try {
    const doc = await adminDb
      .collection(COLLECTIONS.EMAIL_CONFIG)
      .doc(EMAIL_CONFIG_DOC)
      .get();

    if (!doc.exists) return result;

    const stored = (doc.data()?.templates ?? {}) as Record<string, unknown>;

    for (const [key, value] of Object.entries(stored)) {
      if (!isEmailKey(key) || !value || typeof value !== "object") continue;
      const setting = value as Partial<EmailTemplateSetting>;
      result[key] = {
        templateId:
          typeof setting.templateId === "string" ? setting.templateId.trim() : "",
        enabled: setting.enabled !== false,
        updatedAt: toDate(setting.updatedAt),
      };
    }

    return result;
  } catch (error) {
    // Never let a config read failure become a failed payment or a failed
    // webhook. Sending is always best-effort; defaults mean "unconfigured",
    // which `sendEmail()` treats as a skip.
    console.error("Failed to read email template config:", error);
    return result;
  }
});

/**
 * Merge-write of one or more entries. Partial by design: the admin page saves
 * a single row at a time, and a write must never clear a key it did not touch.
 */
export async function setEmailTemplates(
  updates: Partial<Record<EmailKey, { templateId?: string; enabled?: boolean }>>
): Promise<void> {
  const now = new Date();
  const payload: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (!isEmailKey(key) || !value) continue;
    const entry: Record<string, unknown> = { updatedAt: now };
    if (typeof value.templateId === "string") {
      entry.templateId = value.templateId.trim();
    }
    if (typeof value.enabled === "boolean") {
      entry.enabled = value.enabled;
    }
    payload[key] = entry;
  }

  if (Object.keys(payload).length === 0) return;

  await adminDb
    .collection(COLLECTIONS.EMAIL_CONFIG)
    .doc(EMAIL_CONFIG_DOC)
    .set({ templates: payload, updatedAt: now }, { merge: true });
}
