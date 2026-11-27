import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyOwnerWithTenant,
  handleAuthError,
} from "@/lib/auth-helpers";
import { testRouterConnection } from "@/lib/mikrotik";
import { rateLimit } from "@/lib/rate-limit";
import { assertTunnelAddressOwned, ROUTER_TEST_LIMIT } from "@/lib/wg-peers";

const testConnectionSchema = z.object({
  routerIp: z.string().min(1),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const body = await request.json();
    const validation = testConnectionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { routerIp, routerUser, routerPass } = validation.data;

    // Each test is a login attempt on a router. Limited per tenant, and a
    // tunnel address only for the tenant it was provisioned for: see
    // assertTunnelAddressOwned.
    if (!rateLimit(`router-test:${tenantId}`, ROUTER_TEST_LIMIT).ok) {
      return NextResponse.json(
        { success: false, error: "Too many connection tests. Wait a few minutes and try again." },
        { status: 429 }
      );
    }
    await assertTunnelAddressOwned(tenantId, routerIp);

    const result = await testRouterConnection({
      ip: routerIp,
      username: routerUser,
      password: routerPass,
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Could not connect to router",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        version: result.data?.version,
        uptime: result.data?.uptime,
      },
    });
  } catch (error) {
    console.error("Test connection error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
