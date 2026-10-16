import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { normalizeRole } from "@/lib/auth-claims";
import { syncUserClaims } from "@/lib/auth-claims-admin";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { notifyCustomerWelcome } from "@/lib/notifications";
import { reconcileEmail } from "@/lib/email-identity";

const registerSchema = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
});

/**
 * The role and tenant to mint into the token, from the stored document.
 *
 * This route runs on every sign-in and the claims it writes are trusted by
 * every later request without a Firestore read (lib/auth-helpers.ts,
 * lib/server-auth.ts), so what the document asks for is checked rather than
 * copied. Both elevations it could ask for are confirmed independently:
 *
 *  - `"superadmin"` is granted only to the address in SUPERADMIN_EMAIL. A
 *    document claiming the role without the matching email is read as
 *    `"customer"`.
 *  - an owner's `tenantId` is confirmed against that tenant's own
 *    `ownerUid`, and only when the claim is actually changing - a sign-in
 *    that re-states what the token already carries costs no read.
 *
 * firestore.rules closes client writes to /users/{uid}, which is what
 * actually stops someone editing this document. This is the second lock, so
 * a rules regression alone is not a privilege escalation.
 */
async function claimsFromDocument(
  uid: string,
  stored: FirebaseFirestore.DocumentData | undefined,
  isDesignatedSuperadmin: boolean,
  currentClaims: { role: unknown; tenantId: unknown }
): Promise<{ role: "superadmin" | "owner" | "customer"; tenantId: string | null }> {
  const claimed = normalizeRole(stored?.role) ?? "customer";

  if (claimed === "superadmin") {
    return isDesignatedSuperadmin
      ? { role: "superadmin", tenantId: null }
      : { role: "customer", tenantId: null };
  }

  if (claimed !== "owner") return { role: claimed, tenantId: null };

  const tenantId =
    typeof stored?.tenantId === "string" && stored.tenantId
      ? stored.tenantId
      : null;
  if (!tenantId) return { role: "owner", tenantId: null };

  // Already in the token, so it was confirmed when it was first granted.
  const unchanged =
    normalizeRole(currentClaims.role) === "owner" &&
    currentClaims.tenantId === tenantId;
  if (unchanged) return { role: "owner", tenantId };

  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  if (tenantDoc.data()?.ownerUid !== uid) {
    console.warn(
      `[register] ${uid} claims tenant ${tenantId} it does not own, refusing owner claims`
    );
    return { role: "customer", tenantId: null };
  }

  return { role: "owner", tenantId };
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const token = authHeader.split("Bearer ")[1];

    let decodedToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validationResult = registerSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        { success: false, error: "Invalid request data" },
        { status: 400 }
      );
    }

    const { uid, email } = validationResult.data;

    if (uid !== decodedToken.uid) {
      return NextResponse.json(
        { success: false, error: "UID mismatch" },
        { status: 403 }
      );
    }

    // Determine whether this email is the designated superadmin - checked
    // on every call, not just first registration, so a stale env var at
    // original signup time (e.g. a dev/deploy process that hadn't picked up
    // a just-added SUPERADMIN_EMAIL yet) can't permanently lock someone out
    // of the role they're actually entitled to.
    const superadminEmail = (
      process.env.SUPERADMIN_EMAIL ||
      process.env.ADMIN_EMAIL ||
      ""
    )
      .toLowerCase()
      .trim();
    const userEmail = email.toLowerCase().trim();
    const isDesignatedSuperadmin = Boolean(superadminEmail) && userEmail === superadminEmail;

    // Check if user document already exists
    const existingUser = await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(uid)
      .get();

    if (existingUser.exists) {
      const existingData = existingUser.data();

      // Our copies of the address, brought back in line with Firebase Auth.
      //
      // An email change commits when the user clicks a link - possibly on
      // another device, possibly signed out - so there is no moment we can
      // hook to write the copies at the time. This route is called on every
      // sign-in, which makes it the reliable second chance. Cheap: it reads
      // the user record and writes only what actually differs.
      try {
        await reconcileEmail(uid);
      } catch (error) {
        // Never fail a sign-in over a denormalisation fix-up.
        console.error(`[register] email reconcile failed for ${uid}:`, error);
      }

      if (isDesignatedSuperadmin && existingData?.role !== "superadmin") {
        await adminDb.collection(COLLECTIONS.USERS).doc(uid).update({
          role: "superadmin",
        });
        await syncUserClaims(uid, "superadmin", existingData?.tenantId || null);
        return NextResponse.json({
          success: true,
          data: { role: "superadmin", tenantId: existingData?.tenantId || null },
        });
      }

      // Keep the token in step with the document for accounts that predate
      // custom claims, so their next request resolves without a read. What
      // the document asks for is confirmed first - see claimsFromDocument.
      const claims = await claimsFromDocument(
        uid,
        existingData,
        isDesignatedSuperadmin,
        { role: decodedToken.role, tenantId: decodedToken.tenantId }
      );
      await syncUserClaims(uid, claims.role, claims.tenantId);

      // The resolved role, never the stored string: a document asking for
      // more than it can prove must not drive the client's UI either.
      return NextResponse.json({
        success: true,
        data: { role: claims.role, tenantId: claims.tenantId },
      });
    }

    let role: "superadmin" | "owner" | "customer" = "customer";
    if (isDesignatedSuperadmin) {
      role = "superadmin";
    }

    // Create user document
    await adminDb
      .collection(COLLECTIONS.USERS)
      .doc(uid)
      .set({
        uid,
        email,
        role,
        tenantId: null,
        createdAt: FieldValue.serverTimestamp(),
      });

    await syncUserClaims(uid, role, null);

    // Only here, on the branch that actually created the document. This route
    // is also called on every subsequent sign-in to re-sync custom claims,
    // and that path returns far above - putting this any higher would mail a
    // "welcome" on every single login. The superadmin is skipped: it is an
    // operator account, not a signup.
    if (role !== "superadmin") {
      await notifyCustomerWelcome(email);
    }

    return NextResponse.json({
      success: true,
      data: { role, tenantId: null },
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
