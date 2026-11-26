import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError, AuthError } from "@/lib/auth-helpers";
import type { AccountSummary } from "@/lib/account-client";

/**
 * Who the signed-in account is, for the browser's own use.
 *
 * Replaces reading users/{uid} and tenants/{id} through the client SDK. That
 * sent an owner's whole tenant document to the browser, bank details and payment
 * codes included, to render a name and build a link. These four fields are what
 * the client has ever used, and a redirect hint or a nav label is all this
 * decides: every page and API route still authorizes on the server.
 *
 * Only called when claims cannot answer: for an owner's tenant, or an account
 * that predates claims, which verifyAuthenticated backfills on the way through.
 * "No such account yet" is an answer here rather than an error, because the auth
 * listener can legitimately ask before /api/auth/register has created it.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await verifyAuthenticated(request.headers.get("authorization"));

    let tenant: AccountSummary["tenant"] = null;
    if (user.tenantId) {
      const tenantDoc = await adminDb
        .collection(COLLECTIONS.TENANTS)
        .doc(user.tenantId)
        .get();
      const data = tenantDoc.data();
      if (data) {
        tenant = {
          id: tenantDoc.id,
          slug: data.slug,
          businessName: data.businessName,
          monthlyFee: typeof data.monthlyFee === "number" ? data.monthlyFee : null,
        };
      }
    }

    const summary: AccountSummary = {
      role: user.role,
      tenantId: user.tenantId,
      tenant,
    };
    return NextResponse.json({ success: true, data: summary });
  } catch (error) {
    if (error instanceof AuthError && error.message === "User not found") {
      return NextResponse.json({ success: true, data: null });
    }
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
