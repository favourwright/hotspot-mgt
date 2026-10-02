import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
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
    await adminAuth.verifyIdToken(idToken);

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

    const response = NextResponse.json({ success: true });
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
