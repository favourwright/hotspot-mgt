import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { claimsFrom, normalizeRole, UserRole } from "@/lib/auth-claims";
import { syncUserClaims } from "@/lib/auth-claims-admin";

export const SESSION_COOKIE_NAME = "session";
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
 * Resolves the caller's identity server-side from the session cookie — the
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
    // Expired, revoked, or malformed cookie — genuinely logged out.
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

  // Cookie predates custom claims — read the document and backfill them.
  // A failure here is deliberately NOT caught: Firestore being unreachable is
  // not the same as being signed out, and treating it as such sends a
  // perfectly valid session back to /auth in a loop. Let it surface.
  const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
  if (!userDoc.exists) return null;

  const data = userDoc.data()!;
  const role = normalizeRole(data.role) ?? "customer";
  const tenantId = data.tenantId ?? null;

  try {
    await syncUserClaims(decoded.uid, role, tenantId);
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

/** Server-component guard for /superadmin/* pages — redirects before any data is fetched. */
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
