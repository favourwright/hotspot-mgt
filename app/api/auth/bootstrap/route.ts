import { NextResponse } from "next/server";

import { adminAuth } from "@/lib/firebase-admin";
import { getServerUser } from "@/lib/server-auth";

/**
 * Exchanges the server session cookie for a Firebase custom token, so
 * client-side auth can follow a session onto a subdomain.
 *
 * Why this has to exist: the session cookie is scoped to `ogawifi.online`
 * and so reaches every tenant subdomain, but the Firebase JS SDK persists
 * its own auth state in IndexedDB, which is per-origin. A tenant owner
 * signed in at the apex arrives at `{slug}.ogawifi.online` authenticated as
 * far as every server component is concerned, and signed out as far as the
 * browser is concerned -- so the admin layout bounces them to /auth and
 * every `Authorization: Bearer` call has no token to send. There is no
 * Firebase setting for this; minting a custom token from the cookie is the
 * supported way across.
 *
 * POST, not GET, is the CSRF boundary. The session cookie is `SameSite=Lax`,
 * which keeps it off cross-site POSTs entirely, so another origin cannot
 * drive this endpoint on a visitor's behalf and read back a credential.
 */
export async function POST() {
  try {
    // Verifies the cookie's signature, expiry and revocation before it can
    // become a token -- a signed-out-everywhere user gets nothing here.
    const serverUser = await getServerUser();

    if (!serverUser) {
      return NextResponse.json(
        { success: false, error: "No session" },
        { status: 401 }
      );
    }

    // Deliberately carries no custom claims. The client signs in with this
    // and immediately gets its own ID token, whose claims the Admin SDK
    // attaches from the account itself -- duplicating them here would just
    // create a second place for role and tenantId to go stale.
    const token = await adminAuth.createCustomToken(serverUser.uid);

    return NextResponse.json({ success: true, data: { token } });
  } catch (error) {
    console.error("Session bootstrap error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to establish client session" },
      { status: 500 }
    );
  }
}
