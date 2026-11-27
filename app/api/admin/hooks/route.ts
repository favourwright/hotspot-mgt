/**
 * The owner's decision hooks: list and create. See lib/decision-hooks.ts.
 *
 * One hook per tenant in this version. Creating one needs the API Access addon
 * (bought, or bundled in the plan) and an unlocked account; the signing secret is returned once,
 * here, and never again.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { createWithinCapacity, type CapacityCheck } from "@/lib/tenant-capacity";
import { assertHookUrl, checkHookHostResolves } from "@/lib/safe-fetch";
import { encryptHookSecret, generateHookSecret } from "@/lib/hook-secrets";
import { DEFAULT_HOOK_TIMEOUT_MS, HOOK_EVENT } from "@/lib/decision-hook-contract";
import {
  hookView,
  invalidateTenantHooks,
  listTenantHooks,
} from "@/lib/decision-hooks";
import {
  badRequest,
  createHookSchema,
  hookErrorResponse,
  normaliseIds,
} from "@/lib/decision-hook-admin";
import { syncTenantHookGardenLater } from "@/lib/hook-walled-garden";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const hooks = await listTenantHooks(tenantId);
    return NextResponse.json({ success: true, data: hooks.map(hookView) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);

    const validation = createHookSchema.safeParse(await request.json());
    if (!validation.success) return badRequest(validation.error.issues[0].message);
    const input = validation.data;

    // Syntax, then a courtesy resolve so a typo or an internal name is
    // caught now rather than as a failed purchase. The real guard is the
    // connect-time check on every call.
    const url = assertHookUrl(input.url).toString();
    await checkHookHostResolves(url);
    // A browser redirect, not a server fetch, so no resolve check; the
    // syntax rule still keeps it https and off raw IPs and internal names.
    const linkUrl = input.linkUrl ? assertHookUrl(input.linkUrl).toString() : null;

    // One hook per tenant, counted in the same transaction as the create.
    const hooksRef = adminDb.collection(TENANT_COLLECTIONS.hooks(owner.tenantId));
    const capacity: CapacityCheck = {
      counted: hooksRef,
      allowed: 1,
      fullMessage: "You already have a hook. Edit it, or delete it first.",
    };

    const secret = generateHookSecret();
    const encrypted = encryptHookSecret(secret);
    const ref = hooksRef.doc();
    await createWithinCapacity({
      tenantId: owner.tenantId,
      resource: "hooks",
      checks: [capacity],
      write: (tx) => tx.create(ref, {
      name: input.name,
      event: HOOK_EVENT,
      url,
      linkUrl,
      secretCiphertext: encrypted.ciphertext,
      secretKeyVersion: encrypted.keyVersion,
      previousSecretCiphertext: null,
      previousSecretKeyVersion: null,
      previousSecretExpiresAt: null,
      timeoutMs: input.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
      failStrategy: input.failStrategy,
      planIds: normaliseIds(input.planIds),
      locationIds: normaliseIds(input.locationIds),
      // Off until the owner has tested it and switched it on: a typo in a
      // brand-new block hook would otherwise stop sales the second it saved.
      active: false,
      breakerAlertedAt: null,
      createdBy: owner.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      }),
    });
    invalidateTenantHooks(owner.tenantId);
    // Customers on the captive portal must be able to reach the page.
    if (linkUrl) syncTenantHookGardenLater(owner.tenantId, after);

    const hooks = await listTenantHooks(owner.tenantId);
    const created = hooks.find((h) => h.id === ref.id);
    return NextResponse.json({
      success: true,
      data: { hook: created ? hookView(created) : null, secret },
    });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
