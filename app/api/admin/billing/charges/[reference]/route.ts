/**
 * POST /api/admin/billing/charges/[reference]: the dashboard reporting that one of its
 * billing payments (a plan period, an addon or credits) has been paid, once Monnify's checkout
 * returns. Only a claim: `confirmBillingCharge` asks Knomad Pay, checks the payment
 * against the record started for it, and applies it once (lib/billing-charges.ts).
 * Knomad Pay's event and the reconcile cron apply it too if this never comes.
 *
 * Only the owner of the tenant the payment was started for can report it.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { confirmBillingCharge, getBillingCharge } from "@/lib/billing-charges";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const caller = await verifyOwnerWithTenant(request.headers.get("authorization"));
    const { reference } = await params;
    const charge = await getBillingCharge(reference);
    if (!charge || charge.tenantId !== caller.tenantId) {
      return NextResponse.json({ success: false, error: "No such payment." }, { status: 404 });
    }
    const result = await confirmBillingCharge(reference);
    if (result.state === "applied") {
      return NextResponse.json({
        success: true,
        data: {
          kind: result.charge.kind,
          addonKey: result.charge.addonKey,
          credits: result.charge.credits,
          paidThrough: result.charge.periodTo?.toISOString() ?? null,
        },
      });
    }
    if (result.state === "unpaid") {
      // Monnify can take a moment to settle a payment it has just taken.
      return NextResponse.json(
        { success: false, pending: true, error: "We haven't received this payment yet. It can take a minute." },
        { status: 202 }
      );
    }
    const error = result.state === "refused" ? result.error : "This payment cannot be applied here.";
    return NextResponse.json({ success: false, error }, { status: 400 });
  } catch (error) {
    console.error("POST billing charge error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
