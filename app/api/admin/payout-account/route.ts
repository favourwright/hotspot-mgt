/**
 * PUT /api/admin/payout-account: a tenant owner changes the bank account their share of
 * each voucher sale is paid into. See lib/payout-account.ts for the order it is done in.
 *
 * Owner-only, from the caller's own claims, so there is no tenant to spoof. Not behind the
 * billing lock: being paid is never what a lock takes away.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { changePayoutAccount } from "@/lib/payout-account";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  bankCode: z.string().min(3, "Choose your bank"),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
});

export async function PUT(request: NextRequest) {
  try {
    const caller = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const validation = bodySchema.safeParse(await request.json());
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error.issues[0].message }, { status: 400 });
    }
    const result = await changePayoutAccount({ tenantId: caller.tenantId, ...validation.data });
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({
      success: true,
      data: { bankName: result.bankName, accountName: result.accountName, payeeReady: result.payeeReady },
    });
  } catch (error) {
    console.error("PUT payout account error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
