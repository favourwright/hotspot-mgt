import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/firebase-collections";
import { claimsFrom, normalizeRole } from "@/lib/auth-claims";
import { syncUserClaims } from "@/lib/auth-claims-admin";
import {
  getServerUser,
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_HINT_COOKIE_NAME,
  sessionCookieDomain,
} from "@/lib/server-auth";

// Mints the httpOnly session cookie server components verify via
// lib/server-auth.ts. Called once right after client-side sign-in/sign-up -
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
      // Shared across the apex and every tenant subdomain.
      domain: sessionCookieDomain(),
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });

    // Same domain, path and lifetime as the cookie it describes, so the two
    // appear and disappear together across every subdomain. Readable on
    // purpose -- see SESSION_HINT_COOKIE_NAME.
    response.cookies.set(SESSION_HINT_COOKIE_NAME, decoded.uid, {
      httpOnly: false,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      domain: sessionCookieDomain(),
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("Session creation error:", error);
    return NextResponse.json({ success: false, error: "Failed to create session" }, { status: 401 });
  }
}

/**
 * Whether the server still accepts this browser's session cookie.
 *
 * The browser cannot read the session cookie (httpOnly) and cannot see
 * another origin's Firebase state (IndexedDB is per-origin), so when the
 * two disagree there is no way for client code to find out which one is
 * right without asking. This is the asking. It answers a single boolean
 * and hands back no credential, which is why it can be a GET while
 * `/api/auth/bootstrap`, which does hand one back, cannot.
 *
 * It also heals the hint cookie in passing: an `active` session re-sets it
 * and a dead one clears both, so the cheap client-side check goes back to
 * being accurate rather than staying wrong until the next sign-in.
 *
 * `getServerUser()` deliberately throws when Firestore is unreachable, and
 * that must stay a 500 here rather than becoming `active: false`. The
 * client treats anything but an explicit `false` as "still signed in" for
 * exactly that reason.
 */
export async function GET(request: NextRequest) {
  const serverUser = await getServerUser();
  const active = serverUser !== null;

  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";

  const response = NextResponse.json({ success: true, active });

  response.cookies.set(SESSION_HINT_COOKIE_NAME, serverUser?.uid ?? "", {
    httpOnly: false,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    domain: sessionCookieDomain(),
    maxAge: active ? SESSION_COOKIE_MAX_AGE_SECONDS : 0,
  });

  if (!active) {
    // The cookie that just failed verification is expired or revoked, so
    // leaving it in place only means every later request pays to find that
    // out again.
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      path: "/",
      domain: sessionCookieDomain(),
      maxAge: 0,
    });
  }

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  // The domain must match the one it was set with, or the browser keeps
  // the original cookie and sign-out silently does nothing.
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    domain: sessionCookieDomain(),
    maxAge: 0,
  });
  // Must be cleared in the same breath: a hint left behind would have the
  // client exchange it for a custom token and sign the user straight back
  // in, making sign-out look broken.
  response.cookies.set(SESSION_HINT_COOKIE_NAME, "", {
    httpOnly: false,
    path: "/",
    domain: sessionCookieDomain(),
    maxAge: 0,
  });
  return response;
}
