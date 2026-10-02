import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { claimsFrom, normalizeRole } from "@/lib/auth-claims";
import { syncUserClaims } from "@/lib/auth-claims-admin";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS } from "@/lib/server-auth";

// Mints the httpOnly session cookie server components verify via
// lib/server-auth.ts. Called once right after client-side sign-in/sign-up —
// Firebase Auth itself stays entirely client-side, this just gives the
// server a way to know who's asking.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const idToken = body?.idToken;
    if (!idToken || typeof idToken !== "string") {
      return NextResponse.json({ success: false, error: "Missing idToken" }, { status: 400 });
    }

    // Reject anything but a fresh, valid token before minting a long-lived cookie from it.
    const decoded = await adminAuth.verifyIdToken(idToken);

    // A cookie is a snapshot of its token's claims, so an account that has
    // none yet would mint a claimless cookie and force a users/{uid} read on
    // every request for its whole 5-day life. Backfill the claims here and
    // tell the client to come back with a refreshed token, so this costs one
    // read once per account rather than one per request.
    let claimsStale = false;
    if (!claimsFrom(decoded)) {
      try {
        const userDoc = await adminDb.collection(COLLECTIONS.USERS).doc(decoded.uid).get();
        if (userDoc.exists) {
          const data = userDoc.data()!;
          await syncUserClaims(
            decoded.uid,
            normalizeRole(data.role) ?? "customer",
            data.tenantId ?? null
          );
          claimsStale = true;
        }
      } catch (error) {
        // Non-fatal: the cookie below still works, it just falls back to a
        // document read until the next sign-in.
        console.error("Failed to backfill custom claims at session mint:", error);
      }
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_COOKIE_MAX_AGE_SECONDS * 1000,
    });

    // The VPS currently serves this app over plain HTTP (no TLS yet), so a
    // hardcoded secure:true would silently stop the browser from ever
    // storing this cookie in production. Derive it from the actual request
    // instead, so this starts working correctly the moment HTTPS is added.
    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.nextUrl.protocol === "https:";

    const response = NextResponse.json({ success: true, claimsStale });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json({ success: false, error: "Failed to create session" }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
