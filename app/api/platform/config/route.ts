import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import {
  getPlatformConfig,
  setPlatformConfig,
  syncBillingPlanItem,
} from "@/lib/platform-config";
import { BillingPlanConfigItemSchema, TenantBillingPlan } from "@/types/schemas";

// .partial() so a caller can send just {monthlyFee, platformFeePercent, ...}
// without accidentally clobbering the cached paystackPlanCode/paystackPlanAmount
// fields with their schema defaults (null).
const BillingPlanConfigUpdateItemSchema = BillingPlanConfigItemSchema.partial();

const BILLING_PLAN_KEYS = [
  "pay-per-transaction",
  "subscription-only",
  "hybrid",
] as const satisfies readonly TenantBillingPlan[];

const UpdatePlatformConfigSchema = z.object({
  billingPlans: z
    .object({
      "pay-per-transaction": BillingPlanConfigUpdateItemSchema.optional(),
      "subscription-only": BillingPlanConfigUpdateItemSchema.optional(),
      hybrid: BillingPlanConfigUpdateItemSchema.optional(),
    })
    .optional(),
  paystackBearer: z
    .enum([
      "account",
      "subaccount",
    ])
    .optional(),
  wireguard: z
    .object({
      serverPublicKey: z.string().optional(),
      serverEndpoint: z.string().optional(),
      tunnelSubnet: z.string().optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const config = await getPlatformConfig();

    // Return only the billing plans and paystackBearer
    return NextResponse.json({
      success: true,
      data: {
        billingPlans: config.billingPlans,
        paystackBearer: config.paystackBearer,
      },
    });
  } catch (error) {
    console.error("Platform config error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch configuration" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifySuperAdmin(authHeader);

    const body = await request.json();
    const validation = UpdatePlatformConfigSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    // Get current config and merge with updates (per-field, so unspecified
    // fields — like the cached Paystack plan code — are preserved rather
    // than reset to their schema defaults).
    const currentConfig = await getPlatformConfig();

    const mergedBillingPlans = { ...currentConfig.billingPlans };
    for (const tier of BILLING_PLAN_KEYS) {
      const incoming = validation.data.billingPlans?.[tier];
      if (!incoming) continue;

      let merged = { ...mergedBillingPlans[tier], ...incoming };
      // If the fee changed, keep the Paystack plan in sync (create it if
      // this tier never had one, or update its amount if it drifted).
      if (merged.monthlyFee !== mergedBillingPlans[tier].monthlyFee) {
        merged = await syncBillingPlanItem(merged);
      }
      mergedBillingPlans[tier] = merged;
    }

    const updatedConfig = {
      billingPlans: mergedBillingPlans,
      paystackBearer: validation.data.paystackBearer ?? currentConfig.paystackBearer,
      wireguard: {
        ...currentConfig.wireguard,
        ...validation.data.wireguard,
      },
    };

    await setPlatformConfig(updatedConfig);

    return NextResponse.json({
      success: true,
      data: updatedConfig,
    });
  } catch (error) {
    console.error("Update platform config error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
