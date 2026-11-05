/**
 * One generated batch, with its codes and passwords, for the owner who made
 * it. The page polls this while a batch is going onto the router; a poll
 * that finds the run dead (lease lapsed) picks it up again after replying.
 */

import { NextRequest, NextResponse, after } from "next/server";

import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { getBatch, runBatchIfDue } from "@/lib/voucher-generation";
import { generationErrorResponse } from "@/lib/voucher-generation-http";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const { id } = await params;
    const batch = await getBatch(tenantId, id);
    if (!batch) {
      return NextResponse.json({ success: false, error: "Batch not found" }, { status: 404 });
    }

    if (batch.state === "minting") {
      // Claims only a lapsed lease, so a live run is never doubled.
      after(async () => {
        try {
          await runBatchIfDue(tenantId, id);
        } catch (error) {
          console.error(`[voucher-batches] resume ${id} failed:`, error);
        }
      });
    }

    return NextResponse.json({ success: true, data: batch });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
