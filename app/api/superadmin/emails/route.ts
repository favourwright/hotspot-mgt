import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { EMAIL_CATALOG, isEmailKey, type EmailKey } from "@/lib/email-catalog";
import { getEmailTemplates, setEmailTemplates } from "@/lib/email-templates";
import { getEmailSettings, setEmailSettings } from "@/lib/email-settings";
import { isMailtrapConfigured } from "@/lib/mailtrap";

// Partial by design: the page saves one row at a time, and a save must never
// clear a template ID for a key that was not on screen.
const UpdateEmailTemplatesSchema = z.object({
  settings: z
    .object({
      alertRecipients: z.array(z.string().trim().email()).max(25).optional(),
      supportEmail: z.string().trim().email().or(z.literal("")).optional(),
    })
    .optional(),
  templates: z
    .record(
      z.string(),
      z.object({
        templateId: z.string().trim().max(200).optional(),
        enabled: z.boolean().optional(),
      })
    )
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

    const [templates, settings] = await Promise.all([
      getEmailTemplates(),
      getEmailSettings(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        catalog: EMAIL_CATALOG,
        templates,
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
    const validation = UpdateEmailTemplatesSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    if (validation.data.templates) {
      await setEmailTemplates(
        validation.data.templates as Partial<
          Record<EmailKey, { templateId?: string; enabled?: boolean }>
        >
      );
    }

    if (validation.data.settings) {
      await setEmailSettings(validation.data.settings);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update email templates error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
