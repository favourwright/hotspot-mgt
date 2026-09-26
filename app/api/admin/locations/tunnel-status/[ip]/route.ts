import { NextRequest, NextResponse } from "next/server";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { checkWgPeerStatus } from "@/lib/wg-manager";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ip: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyOwnerWithTenant(authHeader);

    const { ip } = await params;

    // Basic IP validation
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return NextResponse.json(
        { success: false, error: "Invalid IP" },
        { status: 400 }
      );
    }

    const result = await checkWgPeerStatus(ip);

    return NextResponse.json({
      success: true,
      data: {
        ip,
        reachable: result.data?.reachable ?? false,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
