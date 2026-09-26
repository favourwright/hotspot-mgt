import { NextRequest, NextResponse } from "next/server";
import { getTenantBySlug } from "@/lib/firestore-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const tenant = await getTenantBySlug(slug);

    if (!tenant) {
      return NextResponse.json(
        { success: false, error: "Tenant not found" },
        { status: 404 }
      );
    }

    if (tenant.status === "suspended") {
      return NextResponse.json(
        { success: false, error: "This portal is currently suspended" },
        { status: 403 }
      );
    }

    // Return only public-safe fields
    return NextResponse.json({
      success: true,
      data: {
        id: tenant.id,
        slug: tenant.slug,
        businessName: tenant.businessName,
        status: tenant.status,
      },
    });
  } catch (error) {
    console.error("Tenant resolve error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
