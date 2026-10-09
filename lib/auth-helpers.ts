import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { claimsFrom, normalizeRole, UserRole } from "@/lib/auth-claims";
import { backfillUserClaims } from "@/lib/auth-claims-admin";

export interface VerifiedUser {
  uid: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

/**
 * Verify a Firebase auth token and return user data.
 * Throws an error if token is invalid.
 */
export async function verifyAuthToken(
  authHeader: string | null
): Promise<VerifiedUser> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", 401);
  }

  const token = authHeader.split("Bearer ")[1];

  let decodedToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch {
    throw new AuthError("Invalid or expired token", 401);
  }

  // The common path: role/tenant ride along in the token's custom claims,
  // so an authenticated request costs no Firestore read at all.
  const claims = claimsFrom(decodedToken);
  if (claims) {
    return {
      uid: decodedToken.uid,
      email: decodedToken.email ?? "",
      ...claims,
    };
  }

  return resolveUserFromDocument(decodedToken.uid, decodedToken.email);
}

/**
 * Fallback for a token minted before this user had custom claims: read the
 * document once, then backfill the claims so the next request skips this.
 */
async function resolveUserFromDocument(
  uid: string,
  tokenEmail?: string
): Promise<VerifiedUser> {
  const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(uid).get();

  if (!userDoc.exists) {
    throw new AuthError("User not found", 401);
  }

  const userData = userDoc.data()!;
  const role = normalizeRole(userData.role) ?? "customer";
  const tenantId = userData.tenantId || null;

  // Best-effort: a failure here only means the next request falls back again.
  try {
    await backfillUserClaims(uid, role, tenantId);
  } catch (error) {
    console.error("Failed to backfill custom claims for", uid, error);
  }

  return {
    uid,
    email: userData.email ?? tokenEmail ?? "",
    role,
    tenantId,
  };
}

/**
 * Verify token and require superadmin role.
 * Throws if user is not superadmin.
 */
export async function verifySuperAdmin(
  authHeader: string | null
): Promise<VerifiedUser> {
  const user = await verifyAuthToken(authHeader);

  if (user.role !== "superadmin") {
    throw new AuthError("Superadmin access required", 403);
  }

  return user;
}

/**
 * Verify token and require owner role.
 * Throws if user is not an owner or superadmin.
 * Optionally verify the owner belongs to a specific tenant.
 */
export async function verifyOwner(
  authHeader: string | null,
  requiredTenantId?: string
): Promise<VerifiedUser> {
  const user = await verifyAuthToken(authHeader);

  if (user.role !== "owner" && user.role !== "superadmin") {
    throw new AuthError("Owner access required", 403);
  }

  if (
    requiredTenantId &&
    user.role === "owner" &&
    user.tenantId !== requiredTenantId
  ) {
    throw new AuthError("Access denied to this tenant", 403);
  }

  return user;
}

/**
 * Verify token and require authenticated user.
 * Any role is accepted. Throws if not authenticated.
 */
export async function verifyAuthenticated(
  authHeader: string | null
): Promise<VerifiedUser> {
  return verifyAuthToken(authHeader);
}

/**
 * Custom error class for auth errors.
 * Carries an HTTP status code.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Verify owner token and return verified user
 * with guaranteed tenantId.
 * Throws if user is not an owner or has no tenant.
 */
export async function verifyOwnerWithTenant(
  authHeader: string | null
): Promise<VerifiedUser & { tenantId: string }> {
  const user = await verifyOwner(authHeader);

  if (!user.tenantId) {
    throw new AuthError("No tenant associated with this account", 403);
  }

  return { ...user, tenantId: user.tenantId };
}

/** Header the browser uses to say which tenant's pages it is on. */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * Read-side tenant resolution for /api/admin/* routes.
 *
 * An owner is always scoped to their own tenant - a slug naming someone
 * else's is rejected, so the header can never widen their access. A
 * superadmin has no tenant of their own but is allowed to view any, which
 * requireTenantOwner already permits for the pages themselves; this keeps
 * the API consistent with that.
 *
 * Writes deliberately do not use this: they stay on verifyOwnerWithTenant,
 * so a superadmin viewing a tenant stays read-only.
 */
export async function verifyTenantAccessBySlug(
  authHeader: string | null,
  tenantSlug: string | null
): Promise<VerifiedUser & { tenantId: string }> {
  const { getCachedTenantBySlug } = await import("@/lib/tenant-cache");
  const user = await verifyOwner(authHeader);

  if (user.role === "owner") {
    if (!user.tenantId) {
      throw new AuthError("No tenant associated with this account", 403);
    }
    if (tenantSlug) {
      const tenant = await getCachedTenantBySlug(tenantSlug);
      if (!tenant || tenant.id !== user.tenantId) {
        throw new AuthError("Access denied to this tenant", 403);
      }
    }
    return { ...user, tenantId: user.tenantId };
  }

  if (!tenantSlug) {
    throw new AuthError("A tenant must be specified for superadmin access", 400);
  }

  const tenant = await getCachedTenantBySlug(tenantSlug);
  if (!tenant) {
    throw new AuthError("Tenant not found", 404);
  }

  return { ...user, tenantId: tenant.id };
}

/**
 * Helper to handle AuthError in API routes.
 * Returns the appropriate HTTP status and message.
 */
export function handleAuthError(error: unknown): {
  message: string;
  status: number;
} {
  if (error instanceof AuthError) {
    return { message: error.message, status: error.statusCode };
  }

  const message =
    error instanceof Error ? error.message : "Internal server error";
  return { message, status: 500 };
}

/** Who a purchase belongs to: a signed-in customer, or a portal guest. */
export interface Purchaser {
  uid: string;
  email: string;
  isGuest: boolean;
}

/**
 * Resolves the buyer for a purchase that may or may not have an account.
 *
 * A valid token always wins -- if someone is signed in, the purchase is
 * theirs, and any guest fields on the request are ignored. Only when there
 * is no token at all does the captive-portal path apply, and then both the
 * device MAC (from the router) and an email (for the receipt, and because
 * Paystack requires one) must be present.
 *
 * An invalid or expired token is an error rather than a silent fall back to
 * guest: that would quietly detach a signed-in customer's purchase from
 * their account the moment their token aged out.
 */
export async function resolvePurchaser(
  authHeader: string | null,
  guest: { deviceMac?: string | null; email?: string | null }
): Promise<Purchaser> {
  if (authHeader) {
    const user = await verifyAuthToken(authHeader);
    return { uid: user.uid, email: user.email, isGuest: false };
  }

  const { guestUidForMac } = await import("@/lib/guest-identity");

  if (!guest.deviceMac || !guest.email) {
    throw new AuthError(
      "Sign in, or buy from the Wi-Fi sign-in page so we know which device to connect.",
      401
    );
  }

  return {
    uid: guestUidForMac(guest.deviceMac),
    email: guest.email,
    isGuest: true,
  };
}
