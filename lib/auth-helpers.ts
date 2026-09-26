import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";

export interface VerifiedUser {
  uid: string;
  email: string;
  role: "superadmin" | "owner" | "customer";
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

  const userDoc = await adminDb
    .collection(COLLECTIONS.USERS)
    .doc(decodedToken.uid)
    .get();

  if (!userDoc.exists) {
    throw new AuthError("User not found", 401);
  }

  const userData = userDoc.data()!;

  // Backward compatibility: treat old "admin" role as "owner"
  let role = userData.role as string;
  if (role === "admin") {
    role = "owner";
  }

  return {
    uid: decodedToken.uid,
    email: userData.email,
    role: role as "superadmin" | "owner" | "customer",
    tenantId: userData.tenantId || null,
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
