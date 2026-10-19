import { NextResponse } from "next/server";
import {
  getAllBillingPlans,
  toPublicBillingPlan,
} from "@/lib/billing-plans";

// Public - the onboarding flow needs to list selectable plans before the
// user has an account yet. Trimmed to what the onboarding card actually
// needs - no Paystack plan codes or internal timestamps.
export async function GET() {
  try {
    const plans = await getAllBillingPlans({ activeOnly: true });
    const safePlans = plans.map(toPublicBillingPlan);
    return NextResponse.json({ success: true, data: safePlans });
  } catch (error) {
    console.error("List onboarding plans error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load billing plans" },
      { status: 500 }
    );
  }
}
