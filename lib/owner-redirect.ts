import { doc, getDoc } from "firebase/firestore";

import { db } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase-collections";

/**
 * Resolves an owner's portal slug so sign-in can land on their dashboard
 * rather than the public landing page - the same directness superadmins
 * get from `/superadmin`.
 *
 * Claims carry `tenantId` but not the slug, so this costs one read, only
 * on an owner's sign-in and only when a tenant is actually attached.
 * Returns `null` on any failure: a missing slug should drop the user on
 * `/`, never block a sign-in that already succeeded.
 */
export async function resolveOwnerAdminPath(
  tenantId: string | null,
  uid: string
): Promise<string | null> {
  if (!db) return null;

  try {
    let id = tenantId;
    if (!id) {
      const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, uid));
      id = (userDoc.data()?.tenantId as string | undefined) ?? null;
    }
    if (!id) return null;

    const tenantDoc = await getDoc(doc(db, COLLECTIONS.TENANTS, id));
    const slug = tenantDoc.data()?.slug as string | undefined;
    return slug ? `/${slug}/admin` : null;
  } catch (err) {
    console.error("Could not resolve tenant slug for redirect:", err);
    return null;
  }
}
