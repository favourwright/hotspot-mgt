import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { ensurePlanCodeForBillingPlan } from "@/lib/billing-plans";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyAuthenticated(authHeader);

    const planId = request.nextUrl.searchParams.get("planId");
    if (!planId) {
      return NextResponse.json(
        { success: false, error: "planId is required" },
        { status: 400 }
      );
    }

    const planCode = await ensurePlanCodeForBillingPlan(planId);

    return NextResponse.json({ success: true, data: { planCode } });
  } catch (error) {
    console.error("Get onboarding plan code error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
