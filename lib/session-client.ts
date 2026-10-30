import {
  decideSessionCheck,
  verdictFromServer,
} from "@/lib/session-reconcile";

/**
 * How many sign-ins are mid-flight on this page.
 *
 * Firebase creates the user before `establishSession()` can mint the
 * cookie, so for that window the browser is correctly ahead of the server
 * and `reconcileClientSession()` must not read the gap as a dead session.
 * A counter rather than a boolean: two overlapping calls must not have the
 * first one to finish clear the flag for both.
 */
let signInsInFlight = 0;

/**
 * Marks a sign-in as under way until the returned function is called.
 *
 * Call it *before* `signInWithEmailAndPassword` / `createUserWithEmailAndPassword`,
 * not after: the listener fires on the credential, not on the cookie.
 */
export function beginSignIn(): () => void {
  signInsInFlight += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    signInsInFlight = Math.max(0, signInsInFlight - 1);
  };
}

export function isSignInInFlight(): boolean {
  return signInsInFlight > 0;
}

/**
 * Mints the server-readable httpOnly session cookie right after Firebase
 * client-side sign-in/sign-up. Without this, server components have no way
 * to know who's asking - see lib/server-auth.ts.
 */
export async function establishSession(idToken: string): Promise<void> {
  // Covers callers that mint a cookie outside a form submit (onboarding's
  // refreshSession, for one). The forms mark the whole submit themselves,
  // because the listener fires well before this function is reached.
  const done = beginSignIn();
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });

    // The route just attached custom claims to an account that had none.
    // This token predates them, so re-mint from a refreshed one -- otherwise
    // the cookie stays claimless and every server render pays for a lookup.
    const result = await response.json().catch(() => null);
    if (result?.claimsStale) {
      const { auth } = await import("@/lib/firebase");
      const refreshed = await auth?.currentUser?.getIdToken(true);
      if (refreshed && refreshed !== idToken) {
        await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: refreshed }),
        });
      }
    }
  } catch (error) {
    console.error("Failed to establish server session:", error);
  } finally {
    done();
  }
}

export async function clearSession(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch (error) {
    console.error("Failed to clear server session:", error);
  }
}

/**
 * Re-mints the session cookie from a freshly refreshed ID token.
 *
 * Call this after anything that changes the signed-in user's role or tenant.
 * Those live in the token's custom claims now, and the session cookie is a
 * snapshot of the token it was minted from - without this, the server keeps
 * seeing the old role until the cookie expires.
 */
export async function refreshSession(): Promise<void> {
  const { auth } = await import("@/lib/firebase");
  if (!auth?.currentUser) return;
  await establishSession(await auth.currentUser.getIdToken(true));
}

/**
 * Whether a server session cookie is present, read from its non-httpOnly
 * companion (SESSION_HINT_COOKIE_NAME in lib/server-auth.ts).
 *
 * Only ever used to decide whether attempting the bootstrap exchange is
 * worth a round trip. A false positive costs one 401.
 */
export function hasSessionHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .some((part) => part.trim().startsWith("session_present="));
}

/**
 * The uid the hint names, or null for no hint or the legacy "1" that says
 * a session exists without saying whose.
 */
function sessionHintUid(): string | null {
  if (typeof document === "undefined") return null;
  const part = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith("session_present="));
  const value = part ? decodeURIComponent(part.slice("session_present=".length)) : "";
  return value && value !== "1" ? value : null;
}

/**
 * Trades the server session cookie for a Firebase custom token and signs
 * the client in with it.
 *
 * This is what carries a sign-in across origins: the cookie is domain-wide,
 * the Firebase SDK's own persistence is not. See /api/auth/bootstrap.
 *
 * Returns false whenever there's nothing to restore -- no hint, no session,
 * a network failure -- so the caller can give up quietly rather than retry.
 */
export async function restoreClientSession(): Promise<boolean> {
  if (!hasSessionHint()) return false;

  try {
    const response = await fetch("/api/auth/bootstrap", { method: "POST" });
    if (!response.ok) return false;

    const result = await response.json();
    const token = result?.data?.token;
    if (typeof token !== "string") return false;

    const [{ auth }, { signInWithCustomToken }] = await Promise.all([
      import("@/lib/firebase"),
      import("firebase/auth"),
    ]);
    if (!auth) return false;

    await signInWithCustomToken(auth, token);
    return true;
  } catch (error) {
    console.error("Failed to restore client session:", error);
    return false;
  }
}

/**
 * Whether the server still accepts this browser's session cookie.
 *
 * Returns `null` for "could not tell" - a network failure, a 500, anything
 * that is not an explicit answer. The caller must read that as "still
 * signed in": a Firestore outage is not a logout, and the one thing worse
 * than a stale session is ending a live one every time the database
 * hiccups.
 */
async function serverSessionActive(): Promise<boolean | null> {
  try {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return typeof body?.active === "boolean" ? body.active : null;
  } catch (error) {
    console.error("Could not check the server session:", error);
    return null;
  }
}

/**
 * Throws away client-side auth state the server does not back.
 *
 * `clearSession()` first and for the same reason sign-out does it first:
 * the hint must be gone before `signOut()` fires the listener, or the
 * bootstrap exchange signs the user straight back in.
 */
async function discardClientSession(): Promise<void> {
  await clearSession();
  const [{ auth }, { signOut }] = await Promise.all([
    import("@/lib/firebase"),
    import("firebase/auth"),
  ]);
  if (!auth) return;
  await signOut(auth);
}

/**
 * Brings this origin's Firebase state back in line with the session cookie,
 * which is the only credential that crosses origins.
 *
 * The mirror image of `restoreClientSession()`: that one repairs "cookie
 * present, browser blank", this one repairs "browser signed in, cookie
 * gone". Without it those two beliefs alternate forever between a guarded
 * page and `/auth` - see `lib/session-reconcile.ts` for the walk-through.
 *
 * "switched" means the cookie belongs to another account and this origin
 * has just signed out of its own, so the listener is about to fire with no
 * user and restore the cookie's account.
 *
 * `force` skips the hint-cookie shortcut and asks the server outright. Only
 * `/auth` sets it, because a revoked cookie leaves the hint behind and
 * `/auth` is the single place where believing a stale client can close a
 * loop.
 *
 * Deliberately never mints a new cookie from the live Firebase credential.
 * That would be the friendlier repair and it is the wrong one: the
 * commonest way to reach this state is signing out on another origin, and
 * re-minting would undo that sign-out.
 */
export async function reconcileClientSession({
  force = false,
}: { force?: boolean } = {}): Promise<"ok" | "stale" | "switched" | "skipped"> {
  const { auth } = await import("@/lib/firebase");

  const verdict = decideSessionCheck({
    signedInClientSide: Boolean(auth?.currentUser),
    clientUid: auth?.currentUser?.uid ?? null,
    hintUid: sessionHintUid(),
    hasHint: hasSessionHint(),
    signInInFlight: isSignInInFlight(),
    forced: force,
  });

  if (verdict === "nothing-to-do") return "skipped";
  if (verdict === "trust-client") return "ok";

  if (verdict === "switch-account") {
    // Sign this origin out without clearSession(): the cookie is the account
    // we are switching to. The listener then fires with no user and the
    // bootstrap exchange signs in as the cookie's account.
    try {
      const { signOut } = await import("firebase/auth");
      if (auth) await signOut(auth);
      return "switched";
    } catch (error) {
      console.error("Failed to switch to the session's account:", error);
      return "ok";
    }
  }

  if (verdictFromServer(await serverSessionActive()) === "ok") return "ok";

  try {
    await discardClientSession();
    return "stale";
  } catch (error) {
    // Report "ok" rather than "stale" on a failed sign-out: the caller uses
    // "stale" to mean "the listener is about to fire with no user", and if
    // that never happens it must not be left waiting on it.
    console.error("Failed to discard a stale client session:", error);
    return "ok";
  }
}
