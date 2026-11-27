import { NextRequest, NextResponse } from "next/server";
import { testRouterConnection } from "@/lib/mikrotik";
import { rateLimit } from "@/lib/rate-limit";
import { assertTunnelAddressOwned, ROUTER_TEST_LIMIT } from "@/lib/wg-peers";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { z } from "zod";

const testConnectionSchema = z.object({
  routerIp: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}$/, "Invalid IP address"),
  routerUser: z.string().min(1, "Router username is required"),
  routerPass: z.string().min(1, "Router password is required"),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await verifyOwnerWithTenant(authHeader);

    const body = await request.json();
    const validationResult = testConnectionSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: validationResult.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { routerIp, routerUser, routerPass } = validationResult.data;

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

    // Test connection
    const result = await testRouterConnection({
      ip: routerIp,
      username: routerUser,
      password: routerPass,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Test connection error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
