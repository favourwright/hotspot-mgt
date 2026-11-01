/**
 * Who owns a router username, and when it is safe to delete.
 *
 * ## Why this is a separate decision from "is this voucher old"
 *
 * `voucher-reap` was written when a username belonged to exactly one
 * voucher for its whole life, so "this voucher expired a fortnight ago"
 * and "nobody needs this login any more" were the same sentence. Renewal
 * ended that. A revive puts a new purchase onto a credential the customer
 * already had (lib/voucher-renewal.ts, `kind: "revive"`), which leaves the
 * old document sitting there as `expired` while a newer one, on the same
 * `username`, is the live plan.
 *
 * Reaping off the old document then deletes the login the new one depends
 * on. That is not theoretical: it happened seven times on one tenant, and
 * four of those took out a plan that was still running - one of them a
 * week-long plan deleted two hours after it was bought.
 *
 * Extend chains were never exposed to this, because `extendVoucher` marks
 * the document it replaces `superseded` and the reaper's query only asks
 * for `expired`. Revive has no such marker, and relying on every future
 * write path to remember to leave one is the fragile version of this fix.
 * So the question is asked of the data instead: of every voucher sharing
 * this username, is any of them still entitled to it?
 *
 * ## The rule
 *
 * The newest non-discarded voucher for a username owns it, and the grace
 * period is measured from *that* voucher's expiry rather than from the one
 * the query happened to return. Everything else for that name is left
 * alone forever - once the name's lifecycle belongs to a later purchase,
 * the earlier documents have no say in it and will never be revisited
 * (the cron's cursor moves past a skipped row by design).
 *
 * ## Why these shapes and not `Voucher`
 *
 * A cron walks whatever is in the collection, including documents written
 * before fields existed and ones that would fail a strict schema parse. A
 * throw here would stop the whole sweep, so this takes a tolerant view of
 * the few fields the decision needs and nothing else.
 */

/** What the decision needs to know about one voucher document. */
export interface ReapView {
  id: string;
  username: string;
  /** `active` | `expired` | `failed` | `superseded`, or anything legacy. */
  status: string;
  expiresAt: Date | null;
  archivedAt: Date | null;
  routerUserReapedAt: Date | null;
}

export type ReapVerdict =
  | { reap: true }
  | {
      reap: false;
      reason: "already-reaped" | "name-in-use" | "name-in-grace";
      /** The voucher that holds the name, for the log line. */
      heldBy: string;
    };

/**
 * Firestore's ceiling on the disjunctions in one `in` filter.
 *
 * Thirty, so a 300-voucher scan costs at most ten extra reads' worth of
 * queries per tenant rather than one query per candidate.
 */
export const USERNAME_CHUNK = 30;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Turns a raw Firestore document into the view above.
 *
 * `value` arrives as a Timestamp from the Admin SDK, as a Date from a test,
 * and as absent from any document written before the field existed.
 */
export function reapViewOf(id: string, data: Record<string, unknown>): ReapView {
  return {
    id,
    username: typeof data.username === "string" ? data.username : "",
    status: typeof data.status === "string" ? data.status : "",
    expiresAt: toDate(data.expiresAt),
    archivedAt: toDate(data.archivedAt),
    routerUserReapedAt: toDate(data.routerUserReapedAt),
  };
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
}

/**
 * Whether a voucher that a candidate shares a username with can still be
 * said to need that username.
 *
 * Three kinds cannot, and each for its own reason:
 *
 *  - `superseded`: a renewal carried this voucher's plan onto a newer
 *    document under the same credential. The newer one is the claimant.
 *  - `failed`: the router write never landed, so this document never had a
 *    user to protect. `extendVoucher`'s failure branch writes one of these
 *    while the previous voucher is still live and still the claimant.
 *  - archived: the owner has stated the router no longer has this user and
 *    never will. Archiving is refused while the user exists, so an archived
 *    document cannot be the current holder of the name. The revive path
 *    already ignores archived vouchers for the same reason
 *    (lib/voucher-renewal.ts).
 */
function claimsUsername(view: ReapView): boolean {
  if (view.archivedAt) return false;
  return view.status !== "superseded" && view.status !== "failed";
}

/**
 * Decides whether the candidate's router user can be deleted.
 *
 * `siblings` is every voucher for the same tenant and username, the
 * candidate included; anything else is filtered out here so a caller
 * passing a wider set cannot change the answer. `cutoff` is the reap
 * horizon the cron already computed: now minus the grace period.
 */
export function reapVerdict(
  candidate: ReapView,
  siblings: ReapView[],
  cutoff: Date
): ReapVerdict {
  if (candidate.routerUserReapedAt) {
    return { reap: false, reason: "already-reaped", heldBy: candidate.id };
  }

  const claimants = siblings
    .filter((v) => v.username === candidate.username)
    .filter(claimsUsername);

  // An active claimant settles it whatever its date says. That deliberately
  // includes one with no `expiresAt`: a voucher bought and never logged in
  // has not started its clock, so its login has to keep working until it
  // does.
  const live = claimants.find((v) => v.status === "active");
  if (live) return { reap: false, reason: "name-in-use", heldBy: live.id };

  // Otherwise the newest expiry among the claimants is the one the grace
  // period runs from. The candidate is in this set, so a name nobody has
  // reused still answers exactly as it did before this function existed.
  let newest: ReapView | null = null;
  for (const view of claimants) {
    if (!view.expiresAt) continue;
    if (!newest?.expiresAt || view.expiresAt > newest.expiresAt) newest = view;
  }

  if (newest?.expiresAt && newest.expiresAt > cutoff) {
    return { reap: false, reason: "name-in-grace", heldBy: newest.id };
  }

  return { reap: true };
}
