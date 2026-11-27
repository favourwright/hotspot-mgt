/**
 * The one thing a superadmin decides about each email: whether it is sent.
 *
 * Content lives in code (`lib/email-content.ts`), so this is a switch per
 * catalog key and nothing else. One Firestore document holds every entry, so
 * a send costs a single read rather than one per email type. The catalog in
 * `lib/email-catalog.ts` stays the authority on *which* keys exist - anything
 * stored here for a key that is no longer in the catalog is ignored on read.
 *
 * The document is still `emailConfig/templates`, from when each entry also
 * held a Mailtrap template UUID. It was not renamed so that nothing had to be
 * migrated, and the reading rules below carry the old meaning forward:
 *
 * - **No entry at all: off.** Under the old scheme an email nobody had set up
 *   had no template and skipped, so a new email still ships silent until a
 *   superadmin switches it on. That is the point of the page.
 * - **An old entry (it still has a `templateId` field): on only if it was
 *   enabled AND had a template.** Those are exactly the emails that were
 *   being delivered before the change, so switching to in-code rendering
 *   starts sending nothing that was not already being sent - in particular
 *   it cannot turn on both `owner.voucher_sold` and `owner.sales_digest`
 *   where only one of them used to have a template.
 * - **A new entry: its `enabled` flag.** Saving a row from the page writes
 *   `enabled` and deletes `templateId`, so each entry moves to the plain
 *   meaning the first time anyone touches it.
 */

import { cache } from "react";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { EMAIL_CATALOG, type EmailKey, isEmailKey } from "@/lib/email-catalog";
import type { EmailSwitch } from "@/types/schemas";

const EMAIL_CONFIG_DOC = "templates";

export type EmailSwitchMap = Record<EmailKey, EmailSwitch>;

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/** The reading rules in the header, as a pure function so they can be tested. */
export function readSwitch(stored: unknown): EmailSwitch {
  if (!stored || typeof stored !== "object") {
    return { enabled: false, updatedAt: null };
  }
  const entry = stored as Record<string, unknown>;
  const enabled = entry.enabled !== false;
  const legacy = "templateId" in entry;
  const hadTemplate =
    typeof entry.templateId === "string" && entry.templateId.trim().length > 0;

  return {
    enabled: legacy ? enabled && hadTemplate : enabled,
    updatedAt: toDate(entry.updatedAt),
  };
}

/** Every catalog key, always, so callers never tell "missing" from "off". */
export const getEmailSwitches = cache(async (): Promise<EmailSwitchMap> => {
  const result = {} as EmailSwitchMap;
  for (const entry of EMAIL_CATALOG) {
    result[entry.key] = readSwitch(undefined);
  }

  try {
    const doc = await adminDb
      .collection(COLLECTIONS.EMAIL_CONFIG)
      .doc(EMAIL_CONFIG_DOC)
      .get();

    if (!doc.exists) return result;

    const stored = (doc.data()?.templates ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(stored)) {
      if (isEmailKey(key)) result[key] = readSwitch(value);
    }
    return result;
  } catch (error) {
    // Never let a config read failure become a failed payment or a failed
    // webhook. Sending is best-effort, and every switch reads as off.
    console.error("Failed to read email switches:", error);
    return result;
  }
});

/**
 * Merge-write of one or more switches. Partial by design: the admin page saves
 * only the rows that changed, and a write must never touch a key it did not.
 */
export async function setEmailSwitches(
  updates: Partial<Record<EmailKey, boolean>>
): Promise<void> {
  const now = new Date();
  const payload: Record<string, Record<string, unknown>> = {};

  for (const [key, enabled] of Object.entries(updates)) {
    if (!isEmailKey(key) || typeof enabled !== "boolean") continue;
    payload[key] = {
      enabled,
      updatedAt: now,
      // Moves the entry onto the plain reading rule (see the header).
      templateId: FieldValue.delete(),
    };
  }

  if (Object.keys(payload).length === 0) return;

  await adminDb
    .collection(COLLECTIONS.EMAIL_CONFIG)
    .doc(EMAIL_CONFIG_DOC)
    .set({ templates: payload, updatedAt: now }, { merge: true });
}
