import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { AuthError } from "@/lib/auth-helpers";
import {
  changeEmailLink,
  requireRecentLogin,
  tenantIdForUser,
  verifyCaller,
} from "@/lib/email-identity";
import { notifyVerifyEmail } from "@/lib/notifications";
import { adminAuth } from "@/lib/firebase-admin";

/**
 * Starts a change of the account's email address.
 *
 * Nothing changes here. This mints a link, sends it to the NEW address, and
 * the change commits only when it is clicked - so an address nobody can read
 * can never become the one on the account. The old address is never asked to
 * confirm anything, because not controlling it is the commonest reason to be
 * on this page at all.
 *
 * Guarded by `auth_time`, not by a dialog. The Admin SDK does not enforce
 * `requires-recent-login` the way the client SDK does, so without this check
 * a stolen session could move the recovery address and then reset the
 * password to complete the takeover.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("That doesn't look like a valid email address"),
});

export async function POST(request: NextRequest) {
  try {
    const caller = await verifyCaller(request.headers.get("authorization"));
    requireRecentLogin(caller.authTime);

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Invalid email" },
        { status: 400 }
      );
    }

    const newEmail = parsed.data.email;
    const user = await adminAuth.getUser(caller.uid);
    const currentEmail = user.email ?? "";

    if (!currentEmail) {
      throw new AuthError("This account has no email address", 400);
    }

    if (newEmail === currentEmail.toLowerCase()) {
      return NextResponse.json(
        { success: false, error: "That is already your email address." },
        { status: 400 }
      );
    }

    let link: string;
    try {
      link = await changeEmailLink(currentEmail, newEmail);
    } catch (error) {
      // The common one is an address already on another account. Firebase
      // phrases it as a code; the person reading it needs a sentence. Any
      // other failure is ours, not theirs.
      const code = (error as { code?: string })?.code ?? "";
      if (code.includes("email-already-exists")) {
        return NextResponse.json(
          {
            success: false,
            error: "That email address is already in use on another account.",
          },
          { status: 409 }
        );
      }
      throw error;
    }

    const outcome = await notifyVerifyEmail({
      email: newEmail,
      verifyUrl: link,
      tenantId: await tenantIdForUser(caller.uid),
      previousEmail: currentEmail,
    });

    if (!outcome.sent) {
      // This one matters more than a failed verification resend: the change
      // is already pending on Firebase's side and the person is about to be
      // told to check an inbox nothing was sent to.
      console.error(
        `[change-email] ${caller.uid}: not sent (${outcome.reason})`
      );
      return NextResponse.json(
        {
          success: false,
          error:
            "We couldn't send the confirmation email. Your address has not been changed - please try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { pendingEmail: newEmail },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: error.statusCode }
      );
    }
    console.error("change-email error:", error);
    return NextResponse.json(
      { success: false, error: "Could not start the email change" },
      { status: 500 }
    );
  }
}
