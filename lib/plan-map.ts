/**
 * Keeps `plan.json` on each router in step with what the router itself
 * believes about its users.
 *
 * The router-rendered status and alogin pages need two things RouterOS will
 * not hand a page:
 *
 *  - the calendar expiry date, which lives in each hotspot user's
 *    `comment` and is exposed through no page variable at all;
 *  - the plan's configured byte quota. `limit-bytes-total` *is* a page
 *    variable, but on the status page it carries the **session** budget,
 *    which RouterOS resets to whatever is left of the allowance every time
 *    the client reconnects. A progress bar built from it would read 0% used
 *    on every login. The figure a customer means by "my data" is the one
 *    configured on the user record, which is what this file carries.
 *
 * Writing it from here, rather than from a scheduler on the router, keeps
 * the comment parsing in a single tested implementation. The previous
 * owner's router-side equivalents (`expiry-map.txt`, `quota-map.txt`) were
 * stale by weeks and missing every user added since they stopped running.
 */

import { listHotspotUsers, writePortalFile, RouterConfig } from "@/lib/mikrotik";
import { parseRouterExpiryComment } from "@/lib/hotspot-users";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { PLAN_MAP_FILE, PlanMapEntry, buildPlanMap } from "@/lib/hotspot-portal";
import { Timestamp } from "firebase-admin/firestore";
import type { HotspotUser } from "@/lib/mikrotik";

export interface PlanMapResult {
  success: boolean;
  /** How many usernames the map ended up carrying. */
  data?: number;
  error?: string;
}

/**
 * Build the map from a listing already in hand.
 *
 * Split out so `router-health` can reuse the single `listHotspotUsers` call
 * it makes per router instead of fetching the same list twice.
 *
 * Two sources for the expiry, in priority order. The router's comment wins
 * because it is what the router will actually enforce, and a voucher whose
 * `expiresAt` we optimistically stamped at purchase can disagree with it.
 * Firestore fills the gap for a voucher bought but not yet logged in, where
 * the on-login script has not written a comment at all. The quota has one
 * source only: the router.
 */
export async function planEntriesFor(
  tenantId: string,
  users: HotspotUser[]
): Promise<Map<string, PlanMapEntry>> {
  const entries = new Map<string, PlanMapEntry>();

  const vouchers = await adminDb
    .collection(TENANT_COLLECTIONS.vouchers(tenantId))
    .where("status", "==", "active")
    .limit(500)
    .get();

  for (const doc of vouchers.docs) {
    const data = doc.data();
    const raw = data.expiresAt;
    const expiry =
      raw instanceof Timestamp ? raw.toDate() : raw ? new Date(raw) : null;
    if (data.username && expiry && !Number.isNaN(expiry.getTime())) {
      entries.set(data.username, { expiry });
    }
  }

  for (const user of users) {
    if (!user.name) continue;

    const entry = entries.get(user.name) ?? {};
    const expiry = parseRouterExpiryComment(user.comment);
    if (expiry) entry.expiry = expiry;

    const quota = Number(user["limit-bytes-total"]);
    if (Number.isFinite(quota) && quota > 0) entry.quota = quota;

    if (entry.expiry || entry.quota) entries.set(user.name, entry);
  }

  return entries;
}

/**
 * Fetch the user list and write the map in one go.
 *
 * Never throws: a router that has gone away between the install finishing
 * and this running must not take the caller down with it. An empty map is
 * still written, so a router whose users were all deleted stops advertising
 * plan details that no longer exist.
 */
export async function refreshPlanMap(
  tenantId: string,
  config: RouterConfig,
  directory: string,
  users?: HotspotUser[]
): Promise<PlanMapResult> {
  try {
    let listing = users;
    if (!listing) {
      const result = await listHotspotUsers(config);
      if (!result.success || !result.data) {
        return { success: false, error: result.error ?? "Router unreachable" };
      }
      listing = result.data;
    }

    const entries = await planEntriesFor(tenantId, listing);
    const written = await writePortalFile(
      config,
      directory,
      PLAN_MAP_FILE,
      buildPlanMap(entries)
    );

    return written.success
      ? { success: true, data: entries.size }
      : { success: false, error: written.error };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
