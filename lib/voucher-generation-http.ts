/**
 * How voucher generation routes answer errors. One place, so the addon gate
 * is a 402 everywhere and the page can offer the addon off that alone.
 */

import { NextResponse } from "next/server";

import { handleAuthError } from "@/lib/auth-helpers";
import { AddonRequiredError } from "@/lib/entitlements";
import { GenerationError } from "@/lib/voucher-generation";

export function generationErrorResponse(error: unknown): NextResponse {
  // 402, not 403: "not yet paid for", so the page can offer the addon.
  if (error instanceof AddonRequiredError) {
    return NextResponse.json(
      {
        success: false,
        error: "Generating codes is part of the Voucher Generation addon. Add it from the Addons page.",
        data: { addonRequired: true },
      },
      { status: 402 }
    );
  }
  if (error instanceof GenerationError) {
    return NextResponse.json(
      { success: false, error: error.message, data: { code: error.code } },
      { status: error.statusCode }
    );
  }
  console.error("Voucher generation route error:", error);
  const { message, status } = handleAuthError(error);
  return NextResponse.json({ success: false, error: message }, { status });
}
