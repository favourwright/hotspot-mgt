import { NextRequest, NextResponse } from "next/server";

// Routes that are always public regardless of tenant
const PUBLIC_PATHS = [
  "/auth",
  "/onboarding",
  "/faq",
  "/api",
  "/_next",
  "/favicon.ico",
];

// Known top-level routes that are NOT tenant slugs
const PLATFORM_ROUTES = [
  "admin",
  "auth",
  "onboarding",
  "faq",
  "superadmin",
  "api",
  "_next",
  "favicon.ico",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip for public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Extract the first path segment
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];

  // If first segment is a known platform route, skip
  if (!firstSegment || PLATFORM_ROUTES.includes(firstSegment)) {
    return NextResponse.next();
  }

  // First segment is potentially a tenant slug
  // Let the [tenantSlug] layout handle validation
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
