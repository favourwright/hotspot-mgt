import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";

export const SESSION_COOKIE_NAME = "session";
// Firebase session cookies can live up to 14 days; 5 keeps the blast radius
// of a stolen cookie small while still avoiding daily re-logins.
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 5;

export interface ServerUser {
  uid: string;
  email: string;
  role: "superadmin" | "owner" | "customer";
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

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
    if (!userDoc.exists) return null;

    const data = userDoc.data()!;
    // Back-compat: treat legacy "admin" role as "owner", same as auth-provider.tsx.
    const role = data.role === "admin" ? "owner" : data.role;

    return {
      uid: decoded.uid,
      email: data.email,
      role,
      tenantId: data.tenantId ?? null,
    };
  } catch {
    // Expired, revoked, or malformed cookie — treat as logged out.
    return null;
  }
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
