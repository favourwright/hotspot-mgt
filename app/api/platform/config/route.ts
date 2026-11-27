import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getPlatformConfig, setPlatformConfig } from "@/lib/platform-config";

// Billing plans used to live here too - they're now their own collection
// with full CRUD, see /api/superadmin/billing-plans and /api/onboarding/plans.
const UpdatePlatformConfigSchema = z.object({
  feeBearer: z.enum(["platform", "tenant"]).optional(),
  wireguard: z
    .object({
      serverPublicKey: z.string().optional(),
      serverEndpoint: z.string().optional(),
      tunnelSubnet: z.string().optional(),
    })
    .optional(),
  processingFeePassthrough: z
    .object({
      enabled: z.boolean().optional(),
      percent: z.number().min(0).max(100).optional(),
      flatFeeKobo: z.number().int().nonnegative().optional(),
      capKobo: z.number().int().nonnegative().optional(),
      waiveFlatFeeBelowKobo: z.number().int().nonnegative().optional(),
    })
    .optional(),
  planFeeGraceDays: z.number().int().min(0).max(365).optional(),
  /**
   * Switches server-side checkout enforcement on or off. Sent as a boolean;
   * stored as the moment it was switched on (see the schema), and switching
   * it on again keeps the original moment.
   */
  requireServerCheckout: z.boolean().optional(),
  voucherGeneration: z
    .object({
      maxBatchSize: z.number().int().min(1).max(500).optional(),
      maxUnusedPerRouter: z.number().int().min(1).max(10000).optional(),
      creditPriceKobo: z.number().int().nonnegative().max(100_000_00).optional(),
      minCreditPurchase: z.number().int().min(1).max(10000).optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const config = await getPlatformConfig();

    return NextResponse.json({
      success: true,
      data: {
        feeBearer: config.feeBearer,
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

    const currentConfig = await getPlatformConfig();

    const updatedConfig = {
      feeBearer: validation.data.feeBearer ?? currentConfig.feeBearer,
      wireguard: {
        ...currentConfig.wireguard,
        ...validation.data.wireguard,
      },
      processingFeePassthrough: {
        ...currentConfig.processingFeePassthrough,
        ...validation.data.processingFeePassthrough,
      },
      planFeeGraceDays:
        validation.data.planFeeGraceDays ?? currentConfig.planFeeGraceDays,
      serverCheckoutRequiredSince:
        validation.data.requireServerCheckout === undefined
          ? currentConfig.serverCheckoutRequiredSince
          : validation.data.requireServerCheckout
            ? (currentConfig.serverCheckoutRequiredSince ?? new Date())
            : null,
      voucherGeneration: {
        ...currentConfig.voucherGeneration,
        ...validation.data.voucherGeneration,
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
