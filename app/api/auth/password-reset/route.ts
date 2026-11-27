import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendEmail } from "@/lib/email";
import {
  firebaseSendsPasswordReset,
  passwordResetLink,
} from "@/lib/email-identity";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/**
 * Sends the password reset email through our own sender.
 *
 * It used to be the browser calling Firebase's `sendPasswordResetEmail()`,
 * which sent Firebase's unbranded email to Firebase's own landing page. The
 * Admin SDK mints the same link here, `passwordResetLink` moves it onto our
 * `/auth/action`, and `account.password_reset` delivers it.
 *
 * Three things this route owes that the browser call got for free or did
 * not need:
 *
 * 1. **The same answer for everyone.** A stranger asking about an address
 *    with no account gets exactly the response an account holder gets, or
 *    the form becomes a way to find out who has an account here. That
 *    includes our own failure: the fallback below runs here, not in the
 *    browser, because "ours failed, try Firebase" is a reply only an account
 *    holder could ever receive.
 * 2. **Never silently nothing.** `sendEmail()` swallows every failure, which
 *    is right for a notification and wrong for the one email standing
 *    between someone and their account. So the outcome is read, and when
 *    ours did not go, Firebase sends its own: the worst case is how every
 *    reset worked before this route existed.
 * 3. **A rate limit.** Firebase's endpoint limits itself; this one would
 *    otherwise let anyone make our Mailtrap account mail any address on
 *    demand. Per address as well as per IP, because a whole hotspot shares
 *    one public IP and the per-IP limit has to allow for that.
 */

export const dynamic = "force-dynamic";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

// A venue's worth of people behind one address, forgetting passwords.
const PER_IP = { max: 10, windowMs: 15 * 60 * 1000 };
// Enough for "I didn't get it" twice, not enough to bury someone's inbox.
const PER_ADDRESS = { max: 3, windowMs: 60 * 60 * 1000 };

const SENT = { success: true } as const;

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "That doesn't look like a valid email address." },
      { status: 400 }
    );
  }
  const email = parsed.data.email;

  // The address is hashed for the limiter key: rate-limit.ts holds keys in
  // memory, and a list of addresses people typed is not worth keeping.
  const addressKey = createHash("sha256").update(email).digest("hex").slice(0, 32);
  const limited =
    !rateLimit(`password-reset:ip:${clientIp(request.headers)}`, PER_IP).ok ||
    !rateLimit(`password-reset:address:${addressKey}`, PER_ADDRESS).ok;
  if (limited) {
    // Said whether or not the address has an account, like everything here.
    return NextResponse.json(
      { success: false, error: "Too many attempts. Wait a few minutes and try again." },
      { status: 429 }
    );
  }

  let link: string | null;
  try {
    link = await passwordResetLink(email);
  } catch (error) {
    // Firebase could not mint a link (quota, outage). Its own send is the
    // only other way, and it may well fail for the same reason, but there is
    // nothing to lose by asking.
    console.error("[password-reset] could not mint a link:", error);
    const ok = await firebaseSendsPasswordReset(email);
    console.warn(`[password-reset] Firebase fallback after mint failure: ${ok ? "sent" : "failed"}`);
    return NextResponse.json(SENT);
  }

  if (!link) {
    // No account. Nothing to send, and the same reply as when there is.
    return NextResponse.json(SENT);
  }

  const outcome = await sendEmail("account.password_reset", {
    to: email,
    variables: { email, reset_url: link },
  });

  if (!outcome.sent) {
    const ok = await firebaseSendsPasswordReset(email);
    // Loud on purpose: every line here is a reset that came from Firebase
    // instead of us, and a run of them means our sending is broken.
    console.error(
      `[password-reset] our send failed (${outcome.reason}${outcome.detail ? `: ${outcome.detail}` : ""}), Firebase fallback ${ok ? "sent" : "ALSO FAILED"}`
    );
  }

  return NextResponse.json(SENT);
}
