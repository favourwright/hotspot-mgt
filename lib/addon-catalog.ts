/**
 * The addons this platform actually gates on.
 *
 * Declared in code rather than read from Firestore, for the same reason
 * lib/email-catalog.ts is: a gate is a call site, and a call site cannot be
 * allowed to depend on a database row somebody might delete. If the catalog
 * lived only in Firestore, removing a document would not remove the
 * `requireAddon("captive-portal")` in the route - it would just make that
 * check reference an addon that no longer exists, and the failure mode of
 * that is either "everyone gets it free" or "nobody can use it", depending
 * which way the lookup fails open.
 *
 * So this file is the source of truth for *which addons exist*. The
 * Firestore document of the same key carries the parts a superadmin should
 * be able to change without a deploy: price, pricing model, copy, whether it
 * is currently sellable.
 *
 * Adding an addon means adding a key here, creating its document from the
 * superadmin page, and calling the gate at the point of use.
 */

export const ADDON_KEYS = ["captive-portal", "api-access"] as const;

export type AddonKey = (typeof ADDON_KEYS)[number];

export function isAddonKey(value: string): value is AddonKey {
  return (ADDON_KEYS as readonly string[]).includes(value);
}

export interface AddonCatalogEntry {
  name: string;
  description: string;
  /**
   * Every place this key is enforced, in plain words. Kept here so the
   * blast radius of selling or withdrawing an addon is readable without
   * grepping, and so a gate added later without updating this is visibly
   * undocumented rather than invisible.
   */
  gates: string[];
}

export const ADDON_CATALOG: Record<AddonKey, AddonCatalogEntry> = {
  "captive-portal": {
    name: "Captive Portal",
    description:
      "Install a branded sign-in page on your routers and sell plans from it. " +
      "We configure the router over your tunnel and host the portal page.",
    gates: [
      "POST /api/admin/locations/[id]/install-portal refuses without it",
      "The hosted portal at {slug}/portal serves a paywall instead of the " +
        "login form and plan list",
    ],
  },
  "api-access": {
    name: "API Access",
    description:
      "Connect your own systems. Decision hooks let your server approve or " +
      "refuse each purchase before the customer pays, and API keys let it " +
      "read your plans, vouchers, payments and customers.",
    gates: [
      "Creating, editing, testing and issuing a new secret for a decision hook " +
        "(/api/admin/hooks/**) refuse without it",
      "Creating an API key (POST /api/admin/api-keys) refuses without it",
      "Every /api/v1 request refuses without it (402); revoking a key never does",
      "Running an existing hook is never gated: if it lapses, a hook set to " +
        "block keeps enforcing until the owner switches it off, which is " +
        "always allowed",
    ],
  },
};

/**
 * The one addon behind every developer-facing feature. Exported so the
 * plan cards can say "API access" for a plan that bundles it.
 */
export const API_ACCESS_ADDON = "api-access" satisfies AddonKey;

/** Defaults for a key that has no Firestore document yet. */
export function catalogEntry(key: AddonKey): AddonCatalogEntry {
  return ADDON_CATALOG[key];
}
