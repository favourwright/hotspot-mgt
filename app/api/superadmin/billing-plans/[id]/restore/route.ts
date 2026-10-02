import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getBillingPlanById, restoreBillingPlan } from "@/lib/billing-plans";

export async function POST(
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

    await restoreBillingPlan(id);
    const updated = await getBillingPlanById(id);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Restore billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
