/**
 * Deciding what to do when the browser and the server disagree about who
 * is signed in.
 *
 * There are two credentials, and only one of them crosses origins:
 *
 *  - the **session cookie**, scoped to the root domain, so the apex,
 *    `superadmin.` and every `{slug}.` see the same one;
 *  - **Firebase's own client state**, persisted in IndexedDB, which is
 *    per-origin and cannot be made otherwise.
 *
 * `/api/auth/bootstrap` already repairs one direction of that disagreement:
 * cookie present, client blank, which is what arriving on a subdomain looks
 * like. Nothing repaired the other direction, and that is what loops:
 *
 *   1. Sign out on `starlink.ogawifi.online`. The cookie is cleared for the
 *      whole domain, and that origin's IndexedDB with it. **The apex's
 *      IndexedDB is untouched** - no page of ours ran there to clear it.
 *   2. Open `ogawifi.online/superadmin`. The server has no cookie, so
 *      `requireSuperAdmin()` redirects to `/auth?redirect=/superadmin`.
 *   3. `/auth` asks the browser, which still holds a Firebase user, and the
 *      gate sends an apparently-signed-in visitor on to `/superadmin`.
 *   4. Go to 2, forever.
 *
 * The same shape appears with no sign-out at all: the cookie lasts 5 days
 * and a Firebase refresh token lasts far longer, so an idle account reaches
 * exactly this state on its own, and a revoked session reaches it
 * immediately.
 *
 * The rule this module encodes: **the session cookie is the truth, in both
 * directions.** Client state that the server does not back is discarded,
 * never trusted and never used to resurrect a session - resurrecting is
 * what would un-sign-out somebody who deliberately signed out on another
 * origin.
 *
 * This file is pure so `npm run test:session-reconcile` can pin the table.
 */

export interface SessionSignals {
  /** Firebase reports a user on this origin. */
  signedInClientSide: boolean;
  /** That user's uid, when there is one. */
  clientUid?: string | null;
  /**
   * The uid the hint cookie names, or null when it names nobody: absent, or
   * the "1" that sessions minted before the hint carried a uid still hold.
   */
  hintUid?: string | null;
  /** The readable companion to the session cookie is present. */
  hasHint: boolean;
  /**
   * A sign-in is mid-flight on this page.
   *
   * `onIdTokenChanged` fires the moment Firebase creates the user, which is
   * before `establishSession()` has had a chance to mint the cookie. For
   * that window the client is correctly ahead of the server, and checking
   * would sign the user out of the sign-in they are completing.
   */
  signInInFlight: boolean;
  /**
   * Ask the server even when the hint says not to bother.
   *
   * Set by `/auth`, the one page where a disagreement can close a loop. It
   * is about to bounce a signed-in visitor somewhere, so it pays one round
   * trip to be sure there is a session behind that belief. A revoked cookie
   * leaves the hint in place, so the cheap check cannot catch that case.
   */
  forced: boolean;
}

export type SessionVerdict =
  /** No client session to reconcile; the bootstrap exchange owns this case. */
  | "nothing-to-do"
  /** Client state stands, with no request made. */
  | "trust-client"
  /** Only the server can settle it. */
  | "ask-server"
  /**
   * The cookie belongs to a different account from this origin's Firebase
   * user: someone signed in as another account on another subdomain. The
   * cookie is the truth, so this origin drops its user (and only its user;
   * the server session stays) and the bootstrap exchange signs it in as the
   * cookie's account. Left alone, the page renders from the cookie while API
   * calls carry the other account's token, and fail as that account.
   */
  | "switch-account";

export function decideSessionCheck(signals: SessionSignals): SessionVerdict {
  if (!signals.signedInClientSide) return "nothing-to-do";
  if (signals.signInInFlight) return "trust-client";
  if (signals.hintUid && signals.clientUid && signals.hintUid !== signals.clientUid) {
    return "switch-account";
  }
  if (signals.forced) return "ask-server";
  // The hint is set and cleared in the same response as the cookie it
  // describes, so its absence beside a live Firebase user is already the
  // disagreement. Asking anyway costs one request and heals a hint that was
  // lost on its own, which is cheaper than wrongly ending a session.
  return signals.hasHint ? "trust-client" : "ask-server";
}

/**
 * What to do with the server's answer.
 *
 * `active` is `false` **only** when the server said so in as many words. A
 * network failure, a 500, an unreachable Firestore: none of those are a
 * logout. `getServerUser()` makes the same call deliberately - treating an
 * outage as "signed out" sends a valid session back to `/auth` in a loop,
 * which is the bug this module exists to end, arrived at from the other
 * side.
 */
export function verdictFromServer(active: boolean | null): "ok" | "stale" {
  return active === false ? "stale" : "ok";
}
