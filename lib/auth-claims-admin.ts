import { adminAuth } from "@/lib/firebase-admin";
import { UserRole } from "@/lib/auth-claims";

/**
 * Writes role/tenantId onto the user's auth record. Must be called anywhere
 * the users/{uid} document's role or tenantId changes, or the token and the
 * document drift apart.
 *
 * Server-only - it pulls in the Admin SDK. The read-side helpers live in
 * lib/auth-claims.ts, which clients can import safely.
 *
 * Claims only reach a client after the next token refresh, and a session
 * cookie keeps whatever claims its ID token carried - so a caller that
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

/**
 * Already-signed-in accounts carry a session cookie minted before claims
 * existed, and a server render cannot re-mint it (cookies are writable only
 * from actions and route handlers). So the fallback in getServerUser runs on
 * every request until that person next signs in - up to the cookie's 5-day
 * life.
 *
 * The document read there is unavoidable; the Auth write is not. This keeps
 * the write to once per account per process, instead of once per request.
 *
 * Genuine role changes must not go through here - they call syncUserClaims
 * directly, so they always write.
 */
const backfilled = new Set<string>();

export async function backfillUserClaims(
  uid: string,
  role: UserRole,
  tenantId: string | null
): Promise<void> {
  if (backfilled.has(uid)) return;
  await syncUserClaims(uid, role, tenantId);
  backfilled.add(uid);
}
