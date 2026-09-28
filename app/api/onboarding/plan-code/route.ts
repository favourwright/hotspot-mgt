import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { ensurePlanCodeForBillingPlan } from "@/lib/platform-config";
import { TenantBillingPlanSchema } from "@/types/schemas";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyAuthenticated(authHeader);

    const billingPlanParam = request.nextUrl.searchParams.get("billingPlan");
    const validation = TenantBillingPlanSchema.safeParse(billingPlanParam);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: "Invalid billing plan" },
        { status: 400 }
      );
    }

    const planCode = await ensurePlanCodeForBillingPlan(validation.data);

    return NextResponse.json({ success: true, data: { planCode } });
  } catch (error) {
    console.error("Get onboarding plan code error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
