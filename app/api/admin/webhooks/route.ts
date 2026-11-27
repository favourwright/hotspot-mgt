/**
 * The owner's webhook endpoints: list and create. See lib/webhooks.ts.
 * Needs the API Access addon and an unlocked account; the signing secret is
 * in this response and nowhere else.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { requireApiAccess } from "@/lib/api-access";
import { createWithinCapacity } from "@/lib/tenant-capacity";
import { assertHookUrl, checkHookHostResolves } from "@/lib/safe-fetch";
import { encryptHookSecret, generateHookSecret } from "@/lib/hook-secrets";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import {
  MAX_ENDPOINTS,
  endpointView,
  invalidateTenantEndpoints,
  listTenantEndpoints,
} from "@/lib/webhooks";
import { createEndpointSchema } from "@/lib/webhook-admin";
import { badRequest, hookErrorResponse } from "@/lib/decision-hook-admin";

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: (await listTenantEndpoints(tenantId)).map(endpointView) });
  } catch (error) {
    return hookErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireApiAccess(owner.tenantId);

    const validation = createEndpointSchema.safeParse(await request.json());
    if (!validation.success) return badRequest(validation.error.issues[0].message);

    const url = assertHookUrl(validation.data.url).toString();
    await checkHookHostResolves(url);

    // Early answer from the cached list; the transaction below holds the line.
    if ((await listTenantEndpoints(owner.tenantId)).length >= MAX_ENDPOINTS) {
      return badRequest(`You can have up to ${MAX_ENDPOINTS} endpoints. Delete one first.`, 409);
    }

    const secret = generateHookSecret();
    const encrypted = encryptHookSecret(secret);
    const endpointsRef = adminDb.collection(TENANT_COLLECTIONS.webhookEndpoints(owner.tenantId));
    const ref = endpointsRef.doc();
    await createWithinCapacity({
      tenantId: owner.tenantId,
      resource: "webhookEndpoints",
      checks: [
        {
          counted: endpointsRef,
          allowed: MAX_ENDPOINTS,
          fullMessage: `You can have up to ${MAX_ENDPOINTS} endpoints. Delete one first.`,
        },
      ],
      write: (tx) => tx.create(ref, {
      url,
      description: validation.data.description,
      events: [...new Set(validation.data.events)],
      secretCiphertext: encrypted.ciphertext,
      secretKeyVersion: encrypted.keyVersion,
      previousSecretCiphertext: null,
      previousSecretKeyVersion: null,
      previousSecretExpiresAt: null,
      // On from the start, unlike a decision hook: a webhook that fails
      // costs nobody a sale, and the owner wants events from now.
      active: true,
      disabledReason: null,
      failingSince: null,
      createdBy: owner.uid,
      createdAt: new Date(),
      }),
    });
    invalidateTenantEndpoints(owner.tenantId);

    const created = (await listTenantEndpoints(owner.tenantId)).find((e) => e.id === ref.id);
    return NextResponse.json({ success: true, data: { endpoint: created ? endpointView(created) : null, secret } });
  } catch (error) {
    return hookErrorResponse(error);
  }
}
