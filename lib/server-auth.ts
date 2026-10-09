import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { claimsFrom, normalizeRole, UserRole } from "@/lib/auth-claims";
import { backfillUserClaims } from "@/lib/auth-claims-admin";
import { appRootDomain } from "@/lib/app-host";

export const SESSION_COOKIE_NAME = "session";

/**
 * A readable companion to the session cookie, holding nothing but the fact
 * that one exists.
 *
 * The session cookie itself is httpOnly, so client code cannot tell a
 * signed-in visitor from an anonymous one until it asks the server. That
 * matters because Firebase's own client-side auth state is per-origin
 * (IndexedDB), so arriving at `{slug}.ogawifi.online` with a perfectly valid
 * session still looks signed-out to the browser -- and the only fix is to
 * exchange the cookie for a custom token (see /api/auth/bootstrap).
 *
 * Without this hint, every anonymous page view -- the portal, a tenant's
 * storefront, /auth itself -- would fire that exchange and get a 401. With
 * it, only visitors who actually have a session pay for the round trip.
 *
 * It is a hint and nothing more: it is not httpOnly, carries no identity,
 * and is never trusted for anything. Forging it buys an attacker one 401.
 */
export const SESSION_HINT_COOKIE_NAME = "session_present";

/**
 * The cookie's `Domain`, so one sign-in works across every host this app
 * serves: the apex, `superadmin.`, and every tenant's `{slug}.` subdomain.
 * A host-only cookie set at the apex is never sent to a subdomain, which
 * would bounce a tenant owner straight back to sign-in at
 * `{slug}.ogawifi.online/admin`.
 *
 * Returns `undefined` — meaning host-only — for an IP or localhost, where
 * `Domain` is either invalid or pointless. That keeps local development and
 * the existing `193.123.183.184:8080` deployment working unchanged.
 *
 * Worth knowing: a domain-wide cookie reaches every subdomain. That's safe
 * while every subdomain is this app, and would stop being safe the day a
 * tenant can serve their own content from theirs.
 */
export function sessionCookieDomain(): string | undefined {
  // A leading dot is legacy syntax; modern browsers treat a plain domain as
  // covering its subdomains. `undefined` means host-only.
  return appRootDomain() ?? undefined;
}
// Firebase session cookies can live up to 14 days; 5 keeps the blast radius
// of a stolen cookie small while still avoiding daily re-logins.
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export interface ServerUser {
  uid: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

/**
 * Resolves the caller's identity server-side from the session cookie - the
 * only thing a server component can trust. Client-side Zustand state
 * (userRole, etc.) is not available here and must never be used to gate
 * data fetching, only the UI.
 */
export async function getServerUser(): Promise<ServerUser | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!session) return null;

  let decoded;
  try {
    decoded = await adminAuth.verifySessionCookie(session, true);
  } catch {
    // Expired, revoked, or malformed cookie - genuinely logged out.
    return null;
  }

  // The session cookie carries the custom claims its ID token had, so the
  // usual case resolves the caller without touching Firestore. The cookie is
  // a snapshot though: a role change needs refreshSession() on the client to
  // re-mint it (see lib/session-client.ts).
  const claims = claimsFrom(decoded);
  if (claims) {
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      ...claims,
    };
  }

  // Cookie predates custom claims - read the document and backfill them.
  // A failure here is deliberately NOT caught: Firestore being unreachable is
  // not the same as being signed out, and treating it as such sends a
  // perfectly valid session back to /auth in a loop. Let it surface.
  const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
  if (!userDoc.exists) return null;

  const data = userDoc.data()!;
  const role = normalizeRole(data.role) ?? "customer";
  const tenantId = data.tenantId ?? null;

  try {
    await backfillUserClaims(decoded.uid, role, tenantId);
  } catch (error) {
    console.error("Failed to backfill custom claims for", decoded.uid, error);
  }

  return {
    uid: decoded.uid,
    email: data.email ?? decoded.email ?? "",
    role,
    tenantId,
  };
}

/** Server-component guard for /superadmin/* pages - redirects before any data is fetched. */
export async function requireSuperAdmin(): Promise<ServerUser> {
  const serverUser = await getServerUser();
  if (!serverUser) {
    redirect("/auth?redirect=/superadmin");
  }
  if (serverUser.role !== "superadmin") {
    redirect("/");
  }
  return serverUser;
}
