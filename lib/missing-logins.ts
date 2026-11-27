/**
 * Which paid logins have gone missing from a router, decided on the user
 * list router-health has already fetched.
 *
 * ## Why this is the only missing login anyone is told about
 *
 * Logins leave routers in ways this app never sees: a tenant clearing out
 * expired users in Winbox, a router reset, someone else with the admin
 * password. Almost all of that is harmless. A login whose plan has ended has
 * nothing left to give anyone, and /admin/users now shows those quietly
 * (lib/hotspot-users.ts). On 2026-11-27 starlinkkonnect had 23 of them and a
 * banner calling every one a problem.
 *
 * What is not harmless is a voucher still `active` with no login behind it:
 * somebody paid and cannot connect, and the first the owner hears of it is
 * the customer. That one case is worth an email, and only when nothing on
 * record explains it - the owner's own Delete button and the reaper both
 * stamp `routerUserReapedAt`, so neither of them ever triggers this.
 *
 * ## On the transition, never on the state
 *
 * Like the router-offline email: the first time a login is seen missing,
 * `routerUserMissingSince` is stamped and the owner is told. Every tick after
 * that is quiet until the login comes back, which clears the stamp, so losing
 * it a second time is a second email rather than silence.
 *
 * Pure, so `npm run test:missing-logins` can pin every case without a router.
 */

/** The fields of a voucher document this decision reads. */
export interface MissingLoginView {
  id: string;
  username: string;
  locationId: string;
  status: string;
  createdAt: Date | null;
  routerUserReapedAt: Date | null;
  routerUserMissingSince: Date | null;
}

/**
 * How long a voucher is given before its login is expected on the router.
 *
 * Fulfilment creates the router user first and writes the voucher straight
 * after (lib/fulfilment-runner.ts), so the two are seconds apart. But
 * router-health lists users before it reads vouchers, and a sale landing
 * between the two would otherwise be reported missing from a listing taken
 * a moment before it existed. One full tick covers it with room to spare.
 */
export const MISSING_LOGIN_GRACE_MS = 15 * 60 * 1000;

export interface MissingLoginChanges {
  /** Active, unaccounted for, and not yet reported: stamp and email. */
  newlyMissing: MissingLoginView[];
  /** Reported earlier and back on the router now: clear the stamp. */
  restored: MissingLoginView[];
}

/**
 * `locationIds` are the locations this router serves; a tenant's other
 * routers have their own users and their own pass. `routerUsernames` must
 * come from a listing that succeeded - an unreachable router is not an
 * empty one, and passing an empty set for it would report every customer.
 */
export function missingLoginChanges(
  vouchers: MissingLoginView[],
  routerUsernames: Set<string>,
  locationIds: Set<string>,
  now: Date
): MissingLoginChanges {
  const newlyMissing: MissingLoginView[] = [];
  const restored: MissingLoginView[] = [];

  for (const voucher of vouchers) {
    if (!locationIds.has(voucher.locationId)) continue;

    const present = routerUsernames.has(voucher.username);

    if (present) {
      if (voucher.routerUserMissingSince) restored.push(voucher);
      continue;
    }

    if (voucher.status !== "active") continue;
    if (voucher.routerUserReapedAt) continue;
    if (voucher.routerUserMissingSince) continue;
    if (
      !voucher.createdAt ||
      now.getTime() - voucher.createdAt.getTime() < MISSING_LOGIN_GRACE_MS
    ) {
      continue;
    }

    newlyMissing.push(voucher);
  }

  return { newlyMissing, restored };
}

/**
 * The usernames as one line for the email. Capped, because a router that
 * was reset can lose every login at once and an email listing four hundred
 * codes is not more useful than one that says how many.
 */
export function missingLoginList(usernames: string[], shown = 10): string {
  const sorted = [...usernames].sort();
  const head = sorted.slice(0, shown).join(", ");
  const rest = sorted.length - shown;
  return rest > 0 ? `${head} and ${rest} more` : head;
}
