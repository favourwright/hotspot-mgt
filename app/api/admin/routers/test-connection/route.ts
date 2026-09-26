import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyOwnerWithTenant,
  handleAuthError,
} from "@/lib/auth-helpers";
import { testRouterConnection } from "@/lib/mikrotik";

const testConnectionSchema = z.object({
  routerIp: z.string().min(1),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyOwnerWithTenant(authHeader);

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
