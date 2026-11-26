/**
 * The addon catalog: a fixed list of keys, with superadmin-editable pricing.
 *
 * Deliberately not full CRUD, unlike lib/billing-plans.ts, and the asymmetry
 * is the point. A billing plan is pure configuration: its price, limits and
 * name are the whole of it, so creating one from the UI produces something
 * that works. An addon is different. It only does anything because a route
 * handler calls `requireAddon(tenantId, "<key>")`, and that is a line of
 * code. An addon created under a key no gate references would be listed,
 * sellable and chargeable while enforcing nothing anywhere.
 *
 * This platform has two flags in exactly that state (`customBranding`,
 * `prioritySupport`): editable in the billing-plan dialog, checked in zero
 * places. A third, `apiAccess`, was replaced by the `api-access` addon. Allowing arbitrary addon
 * creation would be a machine for producing more of them.
 *
 * So lib/addon-catalog.ts owns which addons exist, and this owns everything
 * about them a superadmin should be able to change without a deploy: name,
 * copy, pricing model, price, billing interval, whether it is currently
 * sellable. Adding a genuinely new addon means adding a key there and a gate
 * where it matters, which was always going to be a deploy.
 */

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { ADDON_CATALOG, ADDON_KEYS, AddonKey } from "@/lib/addon-catalog";
import { Addon, UpdateAddonInput } from "@/types/schemas";
import { invalidateAddon } from "@/lib/entitlements";
import { Timestamp } from "firebase-admin/firestore";

function toDate(value: unknown): Date | null {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  return null;
}

/**
 * Every addon the code knows about, merged with whatever the database says.
 *
 * Driven from ADDON_KEYS rather than from the collection, so an addon that
 * has never been configured still appears as an unsellable draft instead of
 * silently vanishing from the superadmin page while its gate stays live in
 * the code, blocking every tenant with no visible explanation.
 */
export async function getAllAddons(options?: {
  sellableOnly?: boolean;
}): Promise<Addon[]> {
  const snapshot = await adminDb.collection(COLLECTIONS.ADDONS).get();
  const stored = new Map(snapshot.docs.map((d) => [d.id, d.data()]));

  return ADDON_KEYS.map((key) => {
    const data = stored.get(key);
    const entry = ADDON_CATALOG[key];

    return {
      key,
      name: data?.name ?? entry.name,
      description: data?.description ?? entry.description,
      // An unconfigured addon is a subscription nobody can buy, never free.
      // Defaulting to free would hand out whatever it gates for nothing.
      pricingModel: data?.pricingModel ?? "subscription",
      amount: data?.amount ?? 0,
      billingInterval: data?.billingInterval ?? "monthly",
      active: data?.active ?? false,
      sortOrder: data?.sortOrder ?? 0,
      createdAt: toDate(data?.createdAt) ?? new Date(),
      updatedAt: toDate(data?.updatedAt) ?? new Date(),
    } satisfies Addon;
  })
    .filter((addon) => (options?.sellableOnly ? addon.active : true))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export async function getAddonByKey(key: AddonKey): Promise<Addon | null> {
  return (await getAllAddons()).find((addon) => addon.key === key) ?? null;
}

/**
 * Save pricing for one addon, creating its document on first save.
 *
 * `set` with merge rather than `create`/`update`, because the document may
 * not exist yet: the key comes from the code, so the first time a superadmin
 * prices an addon is also the first time it is written.
 */
export async function upsertAddon(
  key: AddonKey,
  input: UpdateAddonInput
): Promise<void> {
  const ref = adminDb.collection(COLLECTIONS.ADDONS).doc(key);
  const existing = await ref.get();

  await ref.set(
    {
      ...input,
      amount: input.pricingModel === "free" ? 0 : input.amount,
      createdAt: existing.exists ? existing.data()?.createdAt : new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );

  // Pricing is what every gate reads, so the next check must see the new
  // price rather than the cached one - including the superadmin's own page.
  invalidateAddon(key);
}

