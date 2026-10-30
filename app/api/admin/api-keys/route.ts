/**
 * The owner's API keys: list and create. See lib/api-keys.ts.
 *
 * Creating one needs the API Access addon and an unlocked account. The full
 * key is in this response and nowhere else, ever.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import {
  API_SCOPES,
  MAX_ACTIVE_KEYS,
  createApiKey,
  keyView,
  listTenantKeys,
} from "@/lib/api-keys";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name").max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose at least one permission"),
});

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: (await listTenantKeys(tenantId)).map(keyView) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);

    const validation = createSchema.safeParse(await request.json());
    if (!validation.success) return badRequest(validation.error.issues[0].message);

    const active = (await listTenantKeys(owner.tenantId)).filter((k) => !k.revokedAt);
    if (active.length >= MAX_ACTIVE_KEYS) {
      return badRequest(`You can have up to ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`, 409);
    }

    const { key, record } = await createApiKey({
      tenantId: owner.tenantId,
      name: validation.data.name,
      scopes: [...new Set(validation.data.scopes)],
      createdBy: owner.uid,
    });
    return NextResponse.json({ success: true, data: { key, apiKey: keyView(record) } });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
