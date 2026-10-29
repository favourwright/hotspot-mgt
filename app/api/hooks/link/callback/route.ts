/**
 * Where a tenant sends a customer back after verifying them, completing
 * account linking (lib/hook-links.ts).
 *
 * GET /api/hooks/link/callback?state=&external_id=&t=&sig=
 *
 * Linked only if all of these hold: the signature is the tenant's (HMAC of
 * `<t>.<state>.<external_id>` under the hook's secret, recent), the state
 * exists, is unused and unexpired, and the signed-in customer arriving is
 * the one who started it. Then the customer lands back where they were,
 * with `?link=linked`, or the reason it did not work.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerUser } from "@/lib/server-auth";
import { requestOrigin } from "@/lib/request-origin";
import { decryptHookSecret } from "@/lib/hook-secrets";
import { verifyLinkCallback } from "@/lib/hook-signing";
import { listTenantHooks } from "@/lib/decision-hooks";
import { completeLink, readLinkState } from "@/lib/hook-links";

export async function GET(request: NextRequest) {
  const origin = requestOrigin(request);
  const params = request.nextUrl.searchParams;
  const stateId = params.get("state") ?? "";

  const state = await readLinkState(stateId).catch(() => null);
  const back = (status: string) => {
    const url = new URL(state?.returnTo ?? "/", origin);
    url.searchParams.set("link", status);
    return NextResponse.redirect(url);
  };

  // Same browser, same account: without a session there is nobody to link.
  const user = await getServerUser();
  if (!user) return back("signed_out");
  if (!state) return back("expired");

  try {
    const hook = (await listTenantHooks(state.tenantId)).find((h) => h.id === state.hookId);
    if (!hook) return back("unavailable");

    const now = Date.now();
    const secrets = [decryptHookSecret(hook.secretCiphertext, hook.secretKeyVersion)];
    if (
      hook.previousSecretCiphertext &&
      hook.previousSecretExpiresAt &&
      hook.previousSecretExpiresAt.getTime() > now
    ) {
      secrets.push(
        decryptHookSecret(hook.previousSecretCiphertext, hook.previousSecretKeyVersion ?? 1)
      );
    }

    const externalId = params.get("external_id") ?? "";
    const signed = verifyLinkCallback(
      secrets,
      { t: params.get("t"), state: stateId, externalId, sig: params.get("sig") },
      Math.floor(now / 1000)
    );
    if (!signed) {
      console.warn(`[hooks] link callback with a bad signature for tenant ${state.tenantId}`);
      return back("invalid");
    }

    const result = await completeLink({ state: stateId, uid: user.uid, externalId });
    if (!result.ok) {
      console.warn(`[hooks] link callback refused: ${result.problem} (tenant ${state.tenantId})`);
      // The customer is told less than the log: "someone else's state" and
      // "bad signature" read the same from outside.
      return back(result.problem === "wrong_user" ? "invalid" : result.problem);
    }
    return back("linked");
  } catch (error) {
    console.error("[hooks] link callback failed:", error);
    return back("failed");
  }
}
