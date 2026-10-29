/**
 * This app's own origin as the browser sees it, for building absolute
 * redirect and callback URLs inside a route handler.
 *
 * `request.url` is no good behind nginx: it is the loopback address the
 * proxy talks to. The forwarded host is what the browser used, and it has
 * to be the right one, because the session cookie a callback depends on
 * belongs to that host. But it is a request header, so it is only believed
 * when it names one of our own hosts; anything else falls back to the
 * configured app URL, so a forged header cannot send anyone elsewhere.
 */

import type { NextRequest } from "next/server";
import { safeRedirect } from "@/lib/safe-redirect";

export function requestOrigin(request: NextRequest): string {
  const fallback = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return fallback;
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    new URL(request.url).protocol.replace(":", "");
  const candidate = `${proto}://${host}`;
  return safeRedirect(candidate) ? new URL(candidate).origin : fallback;
}
