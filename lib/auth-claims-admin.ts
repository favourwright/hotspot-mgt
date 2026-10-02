import { adminAuth } from "@/lib/firebase-admin";
import { UserRole } from "@/lib/auth-claims";

/**
 * Writes role/tenantId onto the user's auth record. Must be called anywhere
 * the users/{uid} document's role or tenantId changes, or the token and the
 * document drift apart.
 *
 * Server-only — it pulls in the Admin SDK. The read-side helpers live in
 * lib/auth-claims.ts, which clients can import safely.
 *
 * Claims only reach a client after the next token refresh, and a session
 * cookie keeps whatever claims its ID token carried — so a caller that
 * changes a signed-in user\'s role also needs refreshSession() on the client
 * (see lib/session-client.ts), not just this.
 */
export async function syncUserClaims(
  uid: string,
  role: UserRole,
  tenantId: string | null
): Promise<void> {
  await adminAuth.setCustomUserClaims(uid, { role, tenantId: tenantId ?? null });
}
