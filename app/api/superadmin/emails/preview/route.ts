import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { isEmailKey, type EmailKey } from "@/lib/email-catalog";
import { renderEmail } from "@/lib/email-content";
import { sampleVariables } from "@/lib/email-samples";
import { withDefaults } from "@/lib/email";
import { isMailtrapConfigured, sendMailtrapEmail } from "@/lib/mailtrap";

/**
 * An email rendered with sample values, the job Mailtrap's template editor
 * used to do. `send: true` also mails it to the superadmin asking, whatever
 * its switch says, so a switched-off email can be checked in a real inbox
 * before anyone turns it on.
 */
const PreviewSchema = z.object({
  key: z.string().refine(isEmailKey, "Unknown email key"),
  send: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const user = await verifySuperAdmin(request.headers.get("authorization"));

    const validation = PreviewSchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const key = validation.data.key as EmailKey;
    const rendered = renderEmail(key, await withDefaults(sampleVariables(key)));
    if (!rendered) {
      return NextResponse.json(
        { success: false, error: "This email has no content in lib/email-content.ts" },
        { status: 500 }
      );
    }

    if (validation.data.send) {
      if (!isMailtrapConfigured()) {
        return NextResponse.json(
          { success: false, error: "Mailtrap is not configured on this deployment" },
          { status: 503 }
        );
      }
      const result = await sendMailtrapEmail({
        to: user.email,
        subject: `[Test] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
        category: "test",
      });
      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error ?? "Send failed" },
          { status: 502 }
        );
      }
      console.info(`[email] ${key}: test send to ${user.email}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        sentTo: validation.data.send ? user.email : null,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
