/**
 * "Verify with <business>": starts account linking (lib/hook-links.ts).
 *
 * A browser navigation, not an API call, so it authenticates with the
 * session cookie and answers with redirects. It records a single-use state
 * bound to the signed-in customer, then sends them to the tenant's own
 * verification page with `state`, `uid` and `callback`.
 *
 * GET /api/hooks/link/start?tenant=<slug>&returnTo=<path on this site>
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server-auth";
import { getTenantBySlug } from "@/lib/firestore-helpers";
import { safeRedirect } from "@/lib/safe-redirect";
import { requestOrigin } from "@/lib/request-origin";
import { rateLimit } from "@/lib/rate-limit";
import { listTenantHooks } from "@/lib/decision-hooks";
import { createLinkState, verificationUrl } from "@/lib/hook-links";

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const params = request.nextUrl.searchParams;
  // Only to this site: this is where the customer lands after verifying.
  const returnTo = safeRedirect(params.get("returnTo"), origin) ?? "/";
  const back = (status: string) => {
    const url = new URL(returnTo, origin);
    url.searchParams.set("link", status);
    return NextResponse.redirect(url);
  };

  const user = await getServerUser();
  if (!user) {
    return NextResponse.redirect(
      new URL(`/auth?redirect=${encodeURIComponent(returnTo)}`, origin)
    );
  }

  if (!rateLimit(`linkstart:${user.uid}`, { max: 10, windowMs: 60_000 }).ok) {
    return back("busy");
  }

  try {
    const tenant = await getTenantBySlug(params.get("tenant") ?? "");
    if (!tenant) return back("unavailable");

    const hook = (await listTenantHooks(tenant.id)).find((h) => h.active && h.linkUrl);
    if (!hook?.linkUrl) return back("unavailable");

    const state = await createLinkState({
      tenantId: tenant.id,
      hookId: hook.id,
      uid: user.uid,
      returnTo,
    });

    return NextResponse.redirect(
      verificationUrl(hook.linkUrl, {
        state,
        uid: user.uid,
        callback: `${origin}/api/hooks/link/callback`,
      })
    );
  } catch (error) {
    console.error("[hooks] link start failed:", error);
    return back("failed");
  }
}
