import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { EMAIL_CATALOG, isEmailKey, type EmailKey } from "@/lib/email-catalog";
import { getEmailSwitches, setEmailSwitches } from "@/lib/email-switches";
import { getEmailSettings, setEmailSettings } from "@/lib/email-settings";
import { isMailtrapConfigured } from "@/lib/mailtrap";

// Partial by design: the page saves only the rows that changed, and a save
// must never flip a switch that was not on screen.
const UpdateEmailsSchema = z.object({
  settings: z
    .object({
      alertRecipients: z.array(z.string().trim().email()).max(25).optional(),
      supportEmail: z.string().trim().email().or(z.literal("")).optional(),
    })
    .optional(),
  switches: z
    .record(z.string(), z.boolean())
    .refine(
      (value) => Object.keys(value).every(isEmailKey),
      "Unknown email key - it must exist in lib/email-catalog.ts"
    )
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const [switches, settings] = await Promise.all([
      getEmailSwitches(),
      getEmailSettings(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        catalog: EMAIL_CATALOG,
        switches,
        settings,
        mailtrapConfigured: isMailtrapConfigured(),
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const body = await request.json();
    const validation = UpdateEmailsSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    if (validation.data.switches) {
      await setEmailSwitches(
        validation.data.switches as Partial<Record<EmailKey, boolean>>
      );
    }

    if (validation.data.settings) {
      await setEmailSettings(validation.data.settings);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update email switches error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
