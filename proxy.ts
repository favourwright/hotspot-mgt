import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // For admin routes, let the auth guard component handle it
  // since we're using client-side Firebase auth
  // The auth guard will redirect if not authenticated/authorized
  
  // No server-side route protection needed since:
  // 1. All API routes verify Firebase tokens
  // 2. Client components use AuthGuard for UI protection
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
