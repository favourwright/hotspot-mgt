/**
 * Issues a new signing secret. The old one stays valid for 24 hours, during
 * which every request carries two signatures, so the owner can deploy the
 * new secret to their server without a gap. Returned once, here.
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireAddon } from "@/lib/entitlements";
import { encryptHookSecret, generateHookSecret } from "@/lib/hook-secrets";
import { invalidateTenantHooks } from "@/lib/decision-hooks";
import {
  DECISION_HOOKS_ADDON,
  badRequest,
  hookErrorResponse,
  hookRef,
  loadOwnedHook,
} from "@/lib/decision-hook-admin";

const OVERLAP_MS = 24 * 60 * 60 * 1000;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireAddon(owner.tenantId, DECISION_HOOKS_ADDON);

    const hook = await loadOwnedHook(owner.tenantId, id);
    if (!hook) return badRequest("Hook not found", 404);

    const secret = generateHookSecret();
    const encrypted = encryptHookSecret(secret);
    await hookRef(owner.tenantId, id).update({
      previousSecretCiphertext: hook.secretCiphertext,
      previousSecretKeyVersion: hook.secretKeyVersion,
      previousSecretExpiresAt: new Date(Date.now() + OVERLAP_MS),
      secretCiphertext: encrypted.ciphertext,
      secretKeyVersion: encrypted.keyVersion,
      updatedAt: FieldValue.serverTimestamp(),
    });
    invalidateTenantHooks(owner.tenantId);

    return NextResponse.json({ success: true, data: { secret } });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
