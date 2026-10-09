import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { EMAIL_CATALOG, isEmailKey, type EmailKey } from "@/lib/email-catalog";
import { getEmailTemplates, setEmailTemplates } from "@/lib/email-templates";
import { isMailtrapConfigured } from "@/lib/mailtrap";

// Partial by design: the page saves one row at a time, and a save must never
// clear a template ID for a key that was not on screen.
const UpdateEmailTemplatesSchema = z.object({
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
    ),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const templates = await getEmailTemplates();

    return NextResponse.json({
      success: true,
      data: {
        catalog: EMAIL_CATALOG,
        templates,
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

    await setEmailTemplates(
      validation.data.templates as Partial<
        Record<EmailKey, { templateId?: string; enabled?: boolean }>
      >
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Update email templates error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
