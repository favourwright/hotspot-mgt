import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getAllBillingPlans, createBillingPlan } from "@/lib/billing-plans";
import { CreateBillingPlanInputSchema } from "@/types/schemas";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    // Superadmin management view includes archived plans.
    const plans = await getAllBillingPlans();

    return NextResponse.json({ success: true, data: plans });
  } catch (error) {
    console.error("List billing plans error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const body = await request.json();
    const validation = CreateBillingPlanInputSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const plan = await createBillingPlan(validation.data);

    return NextResponse.json({ success: true, data: plan });
  } catch (error) {
    console.error("Create billing plan error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
