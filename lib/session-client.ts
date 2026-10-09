/**
 * Mints the server-readable httpOnly session cookie right after Firebase
 * client-side sign-in/sign-up. Without this, server components have no way
 * to know who's asking - see lib/server-auth.ts.
 */
export async function establishSession(idToken: string): Promise<void> {
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
