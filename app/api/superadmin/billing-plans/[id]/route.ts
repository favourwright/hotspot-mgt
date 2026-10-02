import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import {
  getBillingPlanById,
  updateBillingPlan,
  deleteBillingPlan,
  syncBillingPlanPaystackCode,
} from "@/lib/billing-plans";
import { UpdateBillingPlanInputSchema } from "@/types/schemas";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const { id } = await params;
    const existing = await getBillingPlanById(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Billing plan not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const validation = UpdateBillingPlanInputSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const input = { ...validation.data };

    // If the fee changed, keep the Paystack plan in sync (create it if this
    // plan never had one, or update its amount if it drifted) - same pattern
    // as the old platform-config PATCH route.
    if (
      input.monthlyFee !== undefined &&
      input.monthlyFee !== existing.monthlyFee
    ) {
      const synced = await syncBillingPlanPaystackCode({
        name: input.name ?? existing.name,
        monthlyFee: input.monthlyFee,
        paystackPlanCode: existing.paystackPlanCode,
        paystackPlanAmount: existing.paystackPlanAmount,
      });
      input.paystackPlanCode = synced.paystackPlanCode;
      input.paystackPlanAmount = synced.paystackPlanAmount;
    }

    await updateBillingPlan(id, input);
    const updated = await getBillingPlanById(id);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Update billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const { id } = await params;
    const existing = await getBillingPlanById(id);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Billing plan not found" },
        { status: 404 }
      );
    }

    // Permanently deleted if unused, archived (soft-deleted) if any tenant
    // still references it - see lib/billing-plans.ts for why.
    const result = await deleteBillingPlan(id);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("Delete billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
