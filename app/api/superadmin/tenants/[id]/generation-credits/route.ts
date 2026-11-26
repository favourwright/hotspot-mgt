/**
 * A tenant's voucher generation quota and credit history, and the one way
 * credits are added or taken away by hand. Superadmin only.
 *
 * While online payments are down this is how a top-up is sold: the tenant
 * pays by transfer and a superadmin grants the credits here with a note.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { verifySuperAdmin } from "@/lib/auth-helpers";
import {
  adjustCredits,
  getGenerationQuota,
  listCreditLedger,
} from "@/lib/voucher-generation";
import { generationErrorResponse } from "@/lib/voucher-generation-http";

const bodySchema = z
  .object({
    delta: z.number().int().refine((n) => n !== 0, "Enter a non-zero number of credits"),
    note: z.string().trim().min(3, "Say why, for the history").max(300),
    /** Kobo the tenant paid for these credits, off-platform. */
    amountReceivedKobo: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => b.amountReceivedKobo == null || b.delta > 0, {
    message: "An amount received goes with a grant, not a deduction",
  });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await verifySuperAdmin(request.headers.get("authorization"));
    const { id } = await params;
    const [quota, ledger] = await Promise.all([getGenerationQuota(id), listCreditLedger(id)]);
    return NextResponse.json({ success: true, data: { quota, ledger } });
  } catch (error) {
    return generationErrorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await verifySuperAdmin(request.headers.get("authorization"));
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }
    const balance = await adjustCredits({
      tenantId: id,
      delta: parsed.data.delta,
      note: parsed.data.note,
      amountReceivedKobo: parsed.data.amountReceivedKobo ?? null,
      by: { uid: admin.uid, email: admin.email ?? null },
    });
    return NextResponse.json({ success: true, data: { balance } });
  } catch (error) {
    return generationErrorResponse(error);
  }
}
