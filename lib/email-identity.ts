/**
 * Changing the address an account is reached at, and proving it works.
 *
 * ## The one rule everything here follows
 *
 * **Never require control of the old mailbox.** Not controlling it is the
 * single commonest reason to want the change - someone typed `gmial.com` at
 * signup and has been unreachable ever since. A flow that confirms on the old
 * address permanently traps exactly the people it exists to help, so the
 * confirmation link goes to the NEW address and the old one is only ever
 * notified, never consulted.
 *
 * Firebase sends its own revocation mail to the old address when a change
 * commits (`RECOVER_EMAIL`), which is the right shape: a safety net that
 * cannot block anything.
 *
 * ## Why the links are minted here rather than in the browser
 *
 * The client SDK has `verifyBeforeUpdateEmail`, and it works - but it sends
 * through Firebase's own template and sender, which would make the one email
 * that establishes trust the only unbranded one we send. The Admin SDK's
 * `generateVerifyAndChangeEmailLink` hands us the link instead, so Firebase
 * keeps ownership of the token and the catalog keeps ownership of the
 * presentation.
 *
 * That trade has a cost worth knowing: the client SDK refuses a stale session
 * with `auth/requires-recent-login`, and the Admin SDK does not. Re-auth is
 * therefore ours to enforce - see `requireRecentLogin` below. A password
 * dialog that only exists in the UI would be decoration.
 */

import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { AuthError } from "@/lib/auth-helpers";

/**
 * How recently the caller must have proved they know the password.
 *
 * Long enough to read a dialog and type carefully, short enough that a device
 * left unlocked on a table is not a standing authorisation to move the
 * account's recovery address somewhere else.
 */
const RECENT_LOGIN_MS = 5 * 60 * 1000;

/**
 * Where every Firebase action link lands.
 *
 * The apex, always, and never a tenant subdomain: Firebase's authorized-domain
 * list takes no wildcards (docs/domain-and-tls.md), so a per-tenant host could
 * never be listed. One fixed URL is authorised once and works for every
 * tenant. Getting back to a subdomain afterwards is our own redirect, not
 * Firebase's.
 */
export function actionHandlerUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}/auth/action`;
}

/**
 * Verifies a bearer token and returns the caller, including `auth_time`.
 *
 * `verifyAuthToken` in lib/auth-helpers.ts resolves role and tenant but drops
 * the raw claims, and `auth_time` is the one thing this feature cannot do
 * without, so it decodes the token itself rather than widening that helper
 * for a single caller.
 */
export async function verifyCaller(authHeader: string | null): Promise<{
  uid: string;
  email: string;
  authTime: number;
}> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", 401);
  }
  try {
    const decoded = await adminAuth.verifyIdToken(authHeader.split("Bearer ")[1]);
    return {
      uid: decoded.uid,
      email: decoded.email ?? "",
      authTime: decoded.auth_time,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("Invalid or expired token", 401);
  }
}

/**
 * Rejects a caller whose session is older than RECENT_LOGIN_MS.
 *
 * `auth_time` is when the user last actually authenticated, and - unlike
 * `iat` - a token refresh does not move it. So this cannot be satisfied by
 * calling `getIdToken(true)`; only a real `reauthenticateWithCredential` will
 * do it, which is the point.
 */
export function requireRecentLogin(authTimeSeconds: number): void {
  const age = Date.now() - authTimeSeconds * 1000;
  if (age > RECENT_LOGIN_MS) {
    throw new AuthError(
      "Please enter your password again to confirm this change.",
      // 401 rather than 403: the caller can fix this and retry, which is
      // exactly what the re-auth dialog does.
      401
    );
  }
}

/** A verification link for the address the account already has. */
export async function verificationLink(email: string): Promise<string> {
  return adminAuth.generateEmailVerificationLink(email, {
    url: actionHandlerUrl(),
    handleCodeInApp: false,
  });
}

/** A link that commits a change to `newEmail` when it is clicked. */
export async function changeEmailLink(
  currentEmail: string,
  newEmail: string
): Promise<string> {
  return adminAuth.generateVerifyAndChangeEmailLink(currentEmail, newEmail, {
    url: actionHandlerUrl(),
    handleCodeInApp: false,
  });
}

/**
 * Brings our copies of an email address back in line with Firebase Auth.
 *
 * Firebase Auth is the only authority here. A change commits when the user
 * clicks a link, possibly on a different device, possibly signed out - so
 * there is no moment we can rely on to write the copies, and this instead
 * reads the truth and reconciles whatever it finds. Safe to call at any time,
 * writes nothing when nothing differs.
 *
 * ## What deliberately does not follow the change
 *
 * `Voucher.userEmail` and `Payment.userEmail` are a record of who bought
 * what, at the address they bought it under. Rewriting them would quietly
 * revise history - the same reasoning that forbids deleting a voucher
 * document to clear reconciliation drift (lib/hotspot-users.ts). A receipt
 * that no longer matches the one Paystack sent is worse than one addressed to
 * an address the customer has since left.
 */
export async function reconcileEmail(uid: string): Promise<{
  email: string;
  updated: string[];
}> {
  const user = await adminAuth.getUser(uid);
  const email = user.email ?? "";
  const updated: string[] = [];

  if (!email) return { email, updated };

  const userRef = adminDb.collection(COLLECTIONS.USERS).doc(uid);
  const userDoc = await userRef.get();
  if (userDoc.exists && userDoc.data()?.email !== email) {
    await userRef.update({ email });
    updated.push("users");
  }

  const tenantId = userDoc.data()?.tenantId as string | undefined;
  if (tenantId) {
    const tenantRef = adminDb.collection(COLLECTIONS.TENANTS).doc(tenantId);
    const tenantDoc = await tenantRef.get();
    if (tenantDoc.exists && tenantDoc.data()?.ownerEmail !== email) {
      await tenantRef.update({ ownerEmail: email, updatedAt: new Date() });
      updated.push("tenants");
    }
  }

  // A customer can have bought from several tenants, so this is a
  // collection-group lookup rather than one known path. Bounded by how many
  // venues one person has ever bought at, which is small. Needs the
  // COLLECTION_GROUP override on `customers.uid` in firestore.indexes.json.
  try {
    const customerDocs = await adminDb
      .collectionGroup("customers")
      .where("uid", "==", uid)
      .limit(50)
      .get();

    for (const doc of customerDocs.docs) {
      if (doc.data().email !== email) {
        await doc.ref.update({ email });
        updated.push(`customers/${doc.ref.parent.parent?.id ?? "?"}`);
      }
    }
  } catch (error) {
    // A missing collection-group index must not fail the whole reconcile:
    // the two copies above are the ones that decide where mail goes, and
    // this one only affects a name in a tenant's customer list.
    console.error("[email-identity] customer reconcile skipped:", error);
  }

  return { email, updated };
}

/** Everything a tenant-aware verification email needs, or null for a customer. */
export async function tenantIdForUser(uid: string): Promise<string | null> {
  const doc = await adminDb.collection(COLLECTIONS.USERS).doc(uid).get();
  const tenantId = doc.data()?.tenantId;
  return typeof tenantId === "string" && tenantId ? tenantId : null;
}
