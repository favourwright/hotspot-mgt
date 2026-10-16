import { NextRequest, NextResponse } from "next/server";
import { getCachedTenantBySlug } from "@/lib/tenant-cache";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // Through the cache, not a raw query. This route is unauthenticated and
    // reachable by anyone who can guess or enumerate a slug, so an
    // uncached read here is a Firestore read per request from the open
    // internet - the same unbounded-read shape that exhausted the daily
    // quota once already (docs/decisions-and-gotchas.md), except this one
    // does not need anybody to be logged in.
    const tenant = await getCachedTenantBySlug(slug);

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
