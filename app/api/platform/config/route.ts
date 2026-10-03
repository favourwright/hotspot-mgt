import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin, handleAuthError } from "@/lib/auth-helpers";
import { getPlatformConfig, setPlatformConfig } from "@/lib/platform-config";

// Billing plans used to live here too - they're now their own collection
// with full CRUD, see /api/superadmin/billing-plans and /api/onboarding/plans.
const UpdatePlatformConfigSchema = z.object({
  paystackBearer: z.enum(["account", "subaccount"]).optional(),
  wireguard: z
    .object({
      serverPublicKey: z.string().optional(),
      serverEndpoint: z.string().optional(),
      tunnelSubnet: z.string().optional(),
    })
    .optional(),
  paystackFeePassthrough: z
    .object({
      enabled: z.boolean().optional(),
      percent: z.number().min(0).max(100).optional(),
      flatFeeKobo: z.number().int().nonnegative().optional(),
      capKobo: z.number().int().nonnegative().optional(),
      waiveFlatFeeBelowKobo: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const config = await getPlatformConfig();

    return NextResponse.json({
      success: true,
      data: {
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

    const currentConfig = await getPlatformConfig();

    const updatedConfig = {
      paystackBearer: validation.data.paystackBearer ?? currentConfig.paystackBearer,
      wireguard: {
        ...currentConfig.wireguard,
        ...validation.data.wireguard,
      },
      paystackFeePassthrough: {
        ...currentConfig.paystackFeePassthrough,
        ...validation.data.paystackFeePassthrough,
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
