/**
 * What stops working when a tenant does not pay their plan fee.
 *
 * ## Why this is not `Tenant.status = "suspended"`
 *
 * That flag already exists and is the wrong tool twice over. `requireTenantOwner`
 * calls `notFound()` on a suspended tenant, so setting it would lock the owner
 * out of the one page where they could pay - a dead end nobody can escape
 * without a superadmin. And it blacks out the tenant's public pages entirely,
 * which punishes the owner's own customers rather than the owner.
 *
 * Suspension stays what it was: a manual, platform-level action for abuse.
 * This is a separate, narrower state that leaves the account readable.
 *
 * ## What it blocks, and what it deliberately does not
 *
 * Blocked: new voucher sales through the portal, and every owner write -
 * creating plans, routers, locations, pushing portal changes.
 *
 * Not blocked:
 *
 *  - **Vouchers already sold.** They live on the router as hotspot users and
 *    keep working whether this app is reachable or not. Reaching in to kill
 *    them would cut off people who already paid the tenant, which is not our
 *    debt to collect from them.
 *  - **Reading anything.** The dashboard, the sales figures, the customer
 *    list. The numbers showing what the account is worth are the argument
 *    for paying, so hiding them works against the whole point.
 *  - **Billing itself.** Paying, changing plan and cancelling stay open, or
 *    the lock has no exit.
 *  - **Notification preferences.** Muting an email is not a privilege worth
 *    withholding, and a locked tenant gets more mail than usual.
 *
 * ## The exempt routes, in full
 *
 * Every mutating `/api/admin` route uses `requireUnlockedOwner`. These five
 * deliberately do not, and each would be a bug to "fix":
 *
 *  - `admin/billing/subscription` and `admin/billing/plan` - the two ways
 *    out. Locking these makes the lock inescapable.
 *  - `admin/notifications` - email preferences, per above.
 *  - `admin/routers/test-connection` and `admin/locations/test` - POST, but
 *    read-only: they reach out to a router and report back. A tenant trying
 *    to work out whether their hardware is reachable is not doing something
 *    we need to withhold.
 *  - `voucher/retry` - re-attempts a voucher whose customer **has already
 *    paid**. Blocking it would hold a stranger's purchase hostage against
 *    the tenant's debt, which is both wrong and the tenant's customer's
 *    problem rather than the tenant's.
 *
 * `admin/addons/route.ts` reads with `verifyOwnerWithTenant` rather than the
 * usual read helper, so it is unlocked by accident rather than by decision -
 * but it is a GET, and locking a read would be wrong anyway.
 *
 * ## Derived, never stored
 *
 * Same rule as `lib/fee-waivers.ts`, which this reads: no job has to run on
 * time for a tenant to be locked or unlocked. Paying flips `subscriptionStatus`
 * and the very next request resolves as unlocked, with nothing to unwind.
 */

import { AuthError, verifyOwnerWithTenant, type VerifiedUser } from "@/lib/auth-helpers";
import { createDocCache } from "@/lib/doc-cache";
import { getPlanFeeState } from "@/lib/fee-waivers";

/**
 * Said to the owner, in the API error and on the page. Names the reason and
 * the way out in one line, because this arrives as a toast on a button they
 * expected to work.
 */
export const BILLING_LOCK_MESSAGE =
  "Your plan fee is overdue, so new sales and changes are paused. Pay or change your plan in Settings to switch everything back on.";

/** Said to a customer at the portal, who has no idea the tenant owes us anything. */
export const BILLING_LOCK_PORTAL_MESSAGE =
  "This business isn't selling new vouchers right now. Please check back later.";

/**
 * A minute, which is short for a cache and long for a hot path.
 *
 * This is checked before every voucher sale, and resolving it costs a tenant
 * document read plus a `feeWaivers` query each time - on the captive portal,
 * where several people hit the same tenant at once and this codebase has
 * already burned a daily read quota doing the per-request version of exactly
 * this.
 *
 * A minute is also the longest anyone should wait after paying, which is why
 * **every path that can clear a lock invalidates explicitly** rather than
 * relying on the TTL: `invalidateBillingLock` is called when a plan fee is
 * paid and when a plan is changed. The TTL is the backstop for the one thing
 * no writer can announce - the clock passing `locksAt` - not the design.
 */
const LOCK_CACHE_MS = 60 * 1000;
const lockCache = createDocCache<boolean>(LOCK_CACHE_MS);

/** Call after anything that could change whether a tenant is locked. */
export function invalidateBillingLock(tenantId: string): void {
  lockCache.invalidate(tenantId);
}

/**
 * Whether this tenant's services are paused for non-payment.
 *
 * Fails **open**. A Firestore outage or a malformed plan must not take every
 * tenant's sales offline: the cost of being wrong in that direction is some
 * unpaid usage, and in the other it is every paying tenant going dark at
 * once because one read failed.
 *
 * The failure is deliberately not cached - `lockCache.get` only stores what
 * the loader returns, and the loader rethrows - so a transient Firestore
 * error does not pin "unlocked" in memory for a minute.
 */
export async function isTenantBillingLocked(tenantId: string): Promise<boolean> {
  try {
    return await lockCache.get(tenantId, async () => {
      const state = await getPlanFeeState(tenantId);
      return state?.locked ?? false;
    });
  } catch (error) {
    console.error(`[billing-lock] could not resolve ${tenantId}:`, error);
    return false;
  }
}

/**
 * Throws when the tenant is locked. 402, not 403: the caller is perfectly
 * entitled to do this and the only thing in the way is money.
 */
export async function assertBillingUnlocked(tenantId: string): Promise<void> {
  if (await isTenantBillingLocked(tenantId)) {
    throw new AuthError(BILLING_LOCK_MESSAGE, 402);
  }
}

/**
 * `verifyOwnerWithTenant` plus the lock, for owner **writes**.
 *
 * Every mutating /api/admin route should use this instead, and the handful
 * that must not are listed in this file's header. Reads stay on
 * `verifyTenantAccessBySlug`, which is unaffected - a locked tenant can
 * still see everything.
 *
 * A superadmin acting through these routes is not exempt and does not need
 * to be: `verifyOwnerWithTenant` rejects them already, because they have no
 * tenant of their own.
 */
export async function requireUnlockedOwner(
  authHeader: string | null
): Promise<VerifiedUser & { tenantId: string }> {
  const caller = await verifyOwnerWithTenant(authHeader);
  await assertBillingUnlocked(caller.tenantId);
  return caller;
}
