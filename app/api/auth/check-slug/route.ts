import { NextRequest, NextResponse } from "next/server";
import { isSlugAvailable } from "@/lib/firestore-helpers";
import { SlugSchema } from "@/types/schemas";

export async function GET(request: NextRequest) {
  try {
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
