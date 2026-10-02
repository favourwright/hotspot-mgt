export type UserRole = "superadmin" | "owner" | "customer";

export interface UserClaims {
  role: UserRole;
  tenantId: string | null;
}

/** Back-compat: the legacy "admin" role is what "owner" is called now. */
export function normalizeRole(raw: unknown): UserRole | null {
  if (raw === "admin") return "owner";
  if (raw === "superadmin" || raw === "owner" || raw === "customer") return raw;
  return null;
}

/**
 * Role and tenant live in the Firebase ID token as custom claims, so
 * resolving who's asking costs zero Firestore reads — the token is already
 * being verified on every request either way.
 *
 * Returns null for a token minted before its user had claims; callers fall
 * back to the users/{uid} document and backfill via syncUserClaims().
 *
 * This module stays free of firebase-admin imports on purpose: client
 * components read claims off their own token and need normalizeRole here.
 */
export function claimsFrom(decoded: Record<string, unknown>): UserClaims | null {
  const role = normalizeRole(decoded.role);
  if (!role) return null;

  const tenantId = decoded.tenantId;
  return {
    role,
    tenantId: typeof tenantId === "string" && tenantId ? tenantId : null,
  };
}
