/**
 * Which optional emails a tenant owner has switched off for themselves.
 *
 * Stored as a list of muted keys on the tenant document, not as a map of
 * every key to a boolean. An absent entry then means "send", which is what
 * makes a brand-new email default to on for every existing tenant without a
 * migration - and what makes a corrupt or partially-written field degrade
 * into sending too much rather than too little.
 *
 * Only keys flagged `optional` in lib/email-catalog.ts can mute anything.
 * Anything else in the stored list is ignored on read, so a key that stops
 * being optional immediately starts sending again even to owners who had
 * muted it, and a stale key left behind by a removed email is inert rather
 * than an error.
 *
 * Clients cannot write this. firestore.rules denies every client write to
 * /tenants/{id}; it is changed only through PATCH /api/admin/notifications,
 * which is owner-only.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { isOptionalEmail, OPTIONAL_OWNER_EMAILS } from "@/lib/email-catalog";
import { getTenantDocById } from "@/lib/tenant-cache";

/** The tenant-document field. Named for what it holds, not for the UI. */
export const OPT_OUT_FIELD = "emailOptOuts";

function sanitise(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (k): k is string => typeof k === "string" && isOptionalEmail(k)
  );
}

/**
 * The muted keys for one tenant.
 *
 * Returns an empty list for a missing tenant, a missing field, or a failed
 * read. That is the fail-safe direction: a Firestore outage must not silently
 * mute an owner's sales emails, and "we could not check your preference" is
 * not a reason to withhold mail the owner is expecting.
 */
export async function getOptOuts(tenantId: string): Promise<string[]> {
  try {
    const tenant = await getTenantDocById(tenantId);
    if (!tenant) return [];
    return sanitise(tenant[OPT_OUT_FIELD]);
  } catch (error) {
    console.error(
      `[notification-prefs] could not read preferences for ${tenantId}, assuming none:`,
      error
    );
    return [];
  }
}

/**
 * True when this tenant has muted this email.
 *
 * A key that is not optional can never be muted, checked here as well as on
 * write - the stored list is data, and data is not trusted to still match the
 * catalog it was written against.
 */
export async function hasOptedOut(
  tenantId: string,
  key: string
): Promise<boolean> {
  if (!isOptionalEmail(key)) return false;
  return (await getOptOuts(tenantId)).includes(key);
}

/**
 * Replaces the whole list, which is what the settings form submits.
 *
 * Anything not optional is dropped rather than rejected: the form posts the
 * state of the switches it was rendered with, and a catalog change between
 * render and submit should not fail the owner's save.
 */
export async function setOptOuts(
  tenantId: string,
  keys: string[]
): Promise<string[]> {
  const clean = Array.from(new Set(sanitise(keys)));
  await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .update({ [OPT_OUT_FIELD]: clean, updatedAt: new Date() });
  return clean;
}

export interface NotificationSetting {
  key: string;
  label: string;
  help: string;
  enabled: boolean;
}

/** What the settings page renders: every optional email and its current state. */
export async function getNotificationSettings(
  tenantId: string
): Promise<NotificationSetting[]> {
  const muted = await getOptOuts(tenantId);
  return OPTIONAL_OWNER_EMAILS.map((email) => ({
    key: email.key,
    // `optional` is what put this entry in the list, so it is always set -
    // the fallbacks exist only to keep this total if that ever stops holding.
    label: email.optional?.label ?? email.name,
    help: email.optional?.help ?? "",
    enabled: !muted.includes(email.key),
  }));
}
