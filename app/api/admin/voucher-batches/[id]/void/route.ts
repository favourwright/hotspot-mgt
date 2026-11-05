/**
 * Withdraws unused codes from a batch: off the router, out of the index.
 * Ungated by the addon and the billing lock on purpose, like uninstalling
 * the portal: taking codes out of circulation must always be possible.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifyOwnerWithTenant } from "@/lib/auth-helpers";
import { voidCodes } from "@/lib/voucher-generation";
import { generationErrorResponse } from "@/lib/voucher-generation-http";

const bodySchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ usernames: z.array(z.string().min(1)).min(1).max(500) }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { tenantId } = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: "Choose which codes to void" }, { status: 400 });
    }
    const result = await voidCodes({
      tenantId,
      batchId: id,
      usernames: "all" in parsed.data ? "all-unused" : parsed.data.usernames,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
