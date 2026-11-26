import { adminAuth } from "@/lib/firebase-admin";

/**
 * Who bought a voucher, from a charge's metadata and the payer's email. The checkout
 * stamps the buyer's uid into the metadata; a charge without one (an old checkout) is
 * matched to an account by email. Null when no account can be found: the sale cannot be
 * attributed to anyone, so it is not fulfilled to anyone.
 *
 * Shared by Knomad Pay's webhook and the reconcile cron, which used to
 * carry identical copies.
 */
export async function resolveSaleBuyer(
  metadataUserId: string | undefined,
  email: string | undefined
): Promise<{ uid: string; email: string } | null> {
  if (metadataUserId && email) return { uid: metadataUserId, email };
  if (!email) return null;
  try {
    const user = await adminAuth.getUserByEmail(email);
    return { uid: user.uid, email };
  } catch {
    return null;
  }
}
