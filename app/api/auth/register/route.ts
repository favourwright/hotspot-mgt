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
      // custom claims, so their next request resolves without a read.
      await syncUserClaims(
        uid,
        normalizeRole(existingData?.role) ?? "customer",
        existingData?.tenantId || null
      );

      return NextResponse.json({
        success: true,
        data: {
          role: existingData?.role,
          tenantId: existingData?.tenantId || null,
        },
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
