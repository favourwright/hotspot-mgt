/**
 * The owner's generated batches: list them, or generate a new one.
 *
 * Generating needs the Voucher Generation addon, an unlocked account and
 * quota. The response comes back as soon as the batch and its quota are
 * recorded; the codes go onto the router after it, and the page polls the
 * batch to watch them land. A request id from the page makes a double click
 * the same batch rather than two.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";

import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { VOUCHER_GENERATION_ADDON } from "@/lib/addon-catalog";
import { requireAddon } from "@/lib/entitlements";
import { createBatch, listBatches, runBatchIfDue } from "@/lib/voucher-generation";
import { generationErrorResponse } from "@/lib/voucher-generation-http";

const createSchema = z.object({
  locationId: z.string().min(1, "Choose a location"),
  planId: z.string().min(1, "Choose a plan"),
  count: z.number().int().min(1, "Generate at least one code"),
  requestId: z.string().min(8).max(64),
});

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    return NextResponse.json({ success: true, data: await listBatches(tenantId) });
  } catch (error) {
    return generationErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireUnlockedOwner(request.headers.get("authorization"));
    await requireAddon(owner.tenantId, VOUCHER_GENERATION_ADDON);

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { batchId, created } = await createBatch({
      tenantId: owner.tenantId,
      createdBy: { uid: owner.uid, email: owner.email ?? null },
      ...parsed.data,
    });

    // After the response: a few hundred codes over a WireGuard tunnel take
    // longer than the proxy waits. A lease makes a duplicate run harmless,
    // and if this process dies the page's poll or router-health resumes it.
    after(async () => {
      try {
        await runBatchIfDue(owner.tenantId, batchId);
      } catch (error) {
        console.error(`[voucher-batches] run ${batchId} failed:`, error);
      }
    });

    return NextResponse.json({ success: true, data: { batchId, created } });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
