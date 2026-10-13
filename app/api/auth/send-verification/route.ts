import { NextRequest, NextResponse } from "next/server";

import { AuthError } from "@/lib/auth-helpers";
import {
  reconcileEmail,
  tenantIdForUser,
  verificationLink,
  verifyCaller,
} from "@/lib/email-identity";
import { notifyVerifyEmail } from "@/lib/notifications";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Sends (or resends) the "confirm your email" link to the address an account
 * already has.
 *
 * Blocks nothing, by design and by instruction: a customer buys vouchers and
 * an owner onboards whether or not they ever click it. The only thing an
 * unverified address costs is a banner - and, for an owner, the uncomfortable
 * fact that failure alerts may be going nowhere.
 *
 * No re-auth here, unlike change-email. This sends to the address already on
 * the account, so the worst a hijacked session achieves is mailing the real
 * owner a link they can ignore.
 */

export const dynamic = "force-dynamic";

/**
 * How often one account may ask for a link.
 *
 * In memory rather than Firestore: this process is the only thing serving the
 * route, a restart costing someone an early retry is harmless, and a write
 * per click to rate-limit a click is the wrong shape. The real backstop is
 * Firebase's own quota on link generation.
 */
const lastSentAt = new Map<string, number>();
const RESEND_INTERVAL_MS = 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const caller = await verifyCaller(request.headers.get("authorization"));

    // Truth about the address and its verified state lives in Firebase Auth,
    // not in the token the caller handed us - which may predate a change made
    // on another device.
    const user = await adminAuth.getUser(caller.uid);

    if (!user.email) {
      throw new AuthError("This account has no email address", 400);
    }

    if (user.emailVerified) {
      // Not an error. A second tab, or a stale banner, and the honest answer
      // is that there is nothing left to do.
      await reconcileEmail(caller.uid);
      return NextResponse.json({
        success: true,
        data: { alreadyVerified: true, email: user.email },
      });
    }

    const previous = lastSentAt.get(caller.uid) ?? 0;
    const wait = RESEND_INTERVAL_MS - (Date.now() - previous);
    if (wait > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Hold on a moment - you can ask for another link in ${Math.ceil(wait / 1000)} seconds.`,
        },
        { status: 429 }
      );
    }
    lastSentAt.set(caller.uid, Date.now());

    const outcome = await notifyVerifyEmail({
      email: user.email,
      verifyUrl: await verificationLink(user.email),
      tenantId: await tenantIdForUser(caller.uid),
    });

    if (!outcome.sent) {
      // Let them try again rather than burning the interval on a send that
      // never happened - an unconfigured template skips silently, and
      // "check your inbox" would be a lie.
      lastSentAt.delete(caller.uid);
      console.error(
        `[send-verification] ${caller.uid}: not sent (${outcome.reason})`
      );
      return NextResponse.json(
        {
          success: false,
          error: "We couldn't send that email just now. Please try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { alreadyVerified: false, email: user.email },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("send-verification error:", error);
    return NextResponse.json(
      { success: false, error: "Could not send the verification email" },
      { status: 500 }
    );
  }
}
