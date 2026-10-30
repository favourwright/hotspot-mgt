/** A new signing secret; the old one stays valid for 24 hours. Returned once. */

import { NextRequest, NextResponse } from "next/server";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { encryptHookSecret, generateHookSecret } from "@/lib/hook-secrets";
import { endpointRef, invalidateTenantEndpoints } from "@/lib/webhooks";
import { loadOwnedEndpoint } from "@/lib/webhook-admin";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);
    const endpoint = await loadOwnedEndpoint(owner.tenantId, id);
    if (!endpoint) return badRequest("Endpoint not found", 404);

    const secret = generateHookSecret();
    const encrypted = encryptHookSecret(secret);
    await endpointRef(owner.tenantId, id).update({
      previousSecretCiphertext: endpoint.secretCiphertext,
      previousSecretKeyVersion: endpoint.secretKeyVersion,
      previousSecretExpiresAt: new Date(Date.now() + 24 * 3600_000),
      secretCiphertext: encrypted.ciphertext,
      secretKeyVersion: encrypted.keyVersion,
      updatedAt: new Date(),
    });
    invalidateTenantEndpoints(owner.tenantId);
    return NextResponse.json({ success: true, data: { secret } });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
