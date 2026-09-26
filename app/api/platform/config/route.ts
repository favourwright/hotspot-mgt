import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import {
  getPlatformConfig,
  setPlatformConfig,
} from "@/lib/platform-config";
import { BillingPlanConfigItemSchema } from "@/types/schemas";

const UpdatePlatformConfigSchema = z.object({
  billingPlans: z
    .object({
      "pay-per-transaction": BillingPlanConfigItemSchema.optional(),
      "subscription-only": BillingPlanConfigItemSchema.optional(),
      hybrid: BillingPlanConfigItemSchema.optional(),
    })
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

    // Return only the billing plans — not WireGuard
    // config which contains sensitive server info
    return NextResponse.json({
      success: true,
      data: {
        billingPlans: config.billingPlans,
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

    // Get current config and merge with updates
    const currentConfig = await getPlatformConfig();

    const updatedConfig = {
      billingPlans: {
        ...currentConfig.billingPlans,
        ...validation.data.billingPlans,
      },
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
