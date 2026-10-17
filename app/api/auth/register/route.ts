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
 * What to put in the token, from the stored document - or nothing at all.
 *
 * This route runs on every sign-in and the claims it writes are trusted by
 * every later request without a Firestore read (lib/auth-helpers.ts,
 * lib/server-auth.ts), so what the document asks for is checked rather than
 * copied. Two elevations it can ask for are confirmed independently:
 *
 *  - `"superadmin"`, against the address in SUPERADMIN_EMAIL.
 *  - an owner's `tenantId`, against that tenant's own `ownerUid`, and only
 *    when the claim is actually changing - a sign-in that re-states what
 *    the token already carries costs no read.
 *
 * **An unconfirmed elevation is refused, never rewritten.** That
 * distinction is the whole point of returning a decision rather than a
 * role, and it was learned the hard way: an earlier version resolved an
 * unconfirmable `"superadmin"` to `"customer"` and synced *that*, so when
 * the VPS turned out to hold a different SUPERADMIN_EMAIL than
 * `.env.production`, the real superadmin was demoted to customer on every
 * sign-in and locked out of /superadmin entirely. Nothing was wrong with
 * their account; a server-side env value had drifted, and the code turned
 * that into destructive, self-repeating damage to live auth state.
 *
 * So: refusing to *grant* on an unproven claim is correct and stays.
 * Writing a *demotion* from the same signal is not, because the signal is
 * our own configuration rather than any evidence about the account. When we
 * cannot confirm, the existing claims are left exactly as they are and the
 * refusal is logged loudly.
 *
 * A genuine demotion still works, and comes from the only place it should:
 * change `role` on the document, and the next sign-in syncs it.
 *
 * firestore.rules closes client writes to /users/{uid}, which is what
 * actually stops someone editing this document. This is the second lock, so
 * a rules regression alone is not a privilege escalation.
 */
export type ClaimDecision =
  | { sync: true; role: "superadmin" | "owner" | "customer"; tenantId: string | null }
  | { sync: false; reason: string };

/**
 * The tenant lookup is injected so the decision table above can be pinned by
 * a test without Firestore - `npm run test:register-claims`. It defaults to
 * the real read, so every call site is unchanged.
 */
export async function claimsFromDocument(
  uid: string,
  stored: FirebaseFirestore.DocumentData | undefined,
  isDesignatedSuperadmin: boolean,
  currentClaims: { role: unknown; tenantId: unknown },
  lookupTenantOwnerUid: (tenantId: string) => Promise<string | null> =
    defaultTenantOwnerUid
): Promise<ClaimDecision> {
  const claimed = normalizeRole(stored?.role) ?? "customer";

  if (claimed === "superadmin") {
    if (isDesignatedSuperadmin) {
      return { sync: true, role: "superadmin", tenantId: null };
    }
    return {
      sync: false,
      reason:
        "document says superadmin but the address does not match " +
        "SUPERADMIN_EMAIL - check that env var on this server before " +
        "assuming the account is wrong",
    };
  }

  if (claimed !== "owner") {
    return { sync: true, role: claimed, tenantId: null };
  }

  const tenantId =
    typeof stored?.tenantId === "string" && stored.tenantId
      ? stored.tenantId
      : null;
  // An owner with no tenant is not an elevation - verifyOwnerWithTenant
  // refuses them anyway - so there is nothing here to confirm.
  if (!tenantId) return { sync: true, role: "owner", tenantId: null };

  // Already in the token, so it was confirmed when it was first granted.
  const unchanged =
    normalizeRole(currentClaims.role) === "owner" &&
    currentClaims.tenantId === tenantId;
  if (unchanged) return { sync: true, role: "owner", tenantId };

  if ((await lookupTenantOwnerUid(tenantId)) !== uid) {
    return {
      sync: false,
      reason: `document claims tenant ${tenantId}, whose ownerUid is somebody else`,
    };
  }

  return { sync: true, role: "owner", tenantId };
}

async function defaultTenantOwnerUid(tenantId: string): Promise<string | null> {
  const tenantDoc = await adminDb
    .collection(COLLECTIONS.TENANTS)
    .doc(tenantId)
    .get();
  const ownerUid = tenantDoc.data()?.ownerUid;
  return typeof ownerUid === "string" ? ownerUid : null;
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
      const decision = await claimsFromDocument(
        uid,
        existingData,
        isDesignatedSuperadmin,
        { role: decodedToken.role, tenantId: decodedToken.tenantId }
      );

      if (!decision.sync) {
        // Deliberately writes nothing. The claims this account already has
        // stay exactly as they are, because the thing we could not confirm
        // is our own configuration, not the account - and demoting a
        // working user over a server-side env value is damage, not safety.
        // Loud, because it is either a real attempt at escalation or a
        // misconfigured server, and both want a human.
        console.error(`[register] refusing to change claims for ${uid}: ${decision.reason}`);

        const existingRole = normalizeRole(decodedToken.role) ?? "customer";
        return NextResponse.json({
          success: true,
          data: {
            role: existingRole,
            tenantId:
              typeof decodedToken.tenantId === "string"
                ? decodedToken.tenantId
                : null,
          },
        });
      }

      await syncUserClaims(uid, decision.role, decision.tenantId);

      // The resolved role, never the stored string: a document asking for
      // more than it can prove must not drive the client's UI either.
      return NextResponse.json({
        success: true,
        data: { role: decision.role, tenantId: decision.tenantId },
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
