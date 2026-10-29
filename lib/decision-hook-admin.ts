/**
 * What the owner's hook routes share: input validation, error mapping and
 * looking a hook up under the caller's own tenant.
 *
 * Every write route invalidates the hooks cache (lib/doc-cache.ts contract),
 * so an edit or a switch-off takes effect on the very next purchase.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { handleAuthError } from "@/lib/auth-helpers";
import { ApiAccessRequiredError } from "@/lib/api-access";
import { SafeFetchError } from "@/lib/safe-fetch";
import { HookSecretsUnavailableError } from "@/lib/hook-secrets";
import { MAX_HOOK_TIMEOUT_MS } from "@/lib/decision-hook-contract";
import { hookFromData, type DecisionHook } from "@/lib/decision-hooks";

const idList = z.array(z.string().min(1).max(128)).max(100).nullable();

export const createHookSchema = z.object({
  name: z.string().trim().min(1, "Give the hook a name").max(80),
  url: z.string().trim().min(1, "Enter your server's URL"),
  timeoutMs: z.number().int().min(500).max(MAX_HOOK_TIMEOUT_MS).optional(),
  // Required, with no default: what happens when the tenant's server is
  // down is a decision the owner has to make knowingly.
  failStrategy: z.enum(["block", "allow"], {
    message: "Choose what happens when your server can't be reached",
  }),
  planIds: idList.optional(),
  locationIds: idList.optional(),
});

export const updateHookSchema = createHookSchema.partial().extend({
  active: z.boolean().optional(),
});

export function hookRef(tenantId: string, hookId: string) {
  return adminDb.collection(TENANT_COLLECTIONS.hooks(tenantId)).doc(hookId);
}

export async function loadOwnedHook(
  tenantId: string,
  hookId: string
): Promise<DecisionHook | null> {
  const snap = await hookRef(tenantId, hookId).get();
  return snap.exists ? hookFromData(snap.id, tenantId, snap.data()!) : null;
}

/** Empty lists mean "everything", stored as null so there is one way to say it. */
export function normaliseIds(ids: string[] | null | undefined): string[] | null {
  return ids && ids.length > 0 ? [...new Set(ids)] : null;
}

export function hookErrorResponse(error: unknown): NextResponse {
  // 402, not 403: "not yet paid for", so the page can offer the addon.
  if (error instanceof ApiAccessRequiredError) {
    return NextResponse.json(
      {
        success: false,
        error: "Hooks are part of the API Access addon. Add it from the Addons page to create or change hooks.",
        data: { apiAccessRequired: true },
      },
      { status: 402 }
    );
  }
  if (error instanceof SafeFetchError && (error.kind === "url" || error.kind === "address")) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  if (error instanceof HookSecretsUnavailableError) {
    console.error("[hooks] HOOK_SECRETS_KEY is not configured on this server");
    return NextResponse.json(
      { success: false, error: "Hooks aren't available on this server yet. Please contact support." },
      { status: 503 }
    );
  }
  console.error("Hook route error:", error);
  const { message, status } = handleAuthError(error);
  return NextResponse.json({ success: false, error: message }, { status });
}

export function badRequest(message: string, status = 400): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}
