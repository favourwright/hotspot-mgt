import { NextRequest, NextResponse } from "next/server";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { SlugSchema } from "@/types/schemas";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

// Public, and every call below costs a Firestore read from the shared daily
// quota. Debounced typing in onboarding is nowhere near this, even with several
// people on one address.
const CHECK_SLUG_LIMIT = { max: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  try {
    if (!rateLimit(`check-slug:${clientIp(request.headers)}`, CHECK_SLUG_LIMIT).ok) {
      return NextResponse.json(
        { success: false, error: "Too many requests" },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug) {
      return NextResponse.json(
        { success: false, error: "Slug is required" },
        { status: 400 }
      );
    }

    const validation = SlugSchema.safeParse(slug);
    if (!validation.success) {
      return NextResponse.json({
        success: true,
        data: {
          available: false,
          reason: validation.error.issues[0].message,
        },
      });
    }

    const available = await isSlugAvailable(slug);

    return NextResponse.json({
      success: true,
      data: { available },
    });
  } catch (error) {
    console.error("Slug check error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
