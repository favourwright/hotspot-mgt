import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleAuthError } from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { addWgPeer } from "@/lib/wg-manager";
import { getPlatformConfig } from "@/lib/platform-config";

const provisionSchema = z.object({
  publicKey: z.string().min(10, "Invalid WireGuard public key"),
  locationName: z.string().min(2),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await requireUnlockedOwner(authHeader);

    const body = await request.json();
    const validation = provisionSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    const { publicKey } = validation.data;

    // Get VPS WireGuard config from platform config
    const platformConfig = await getPlatformConfig();
    const { serverPublicKey, serverEndpoint, tunnelSubnet } =
      platformConfig.wireguard;

    // Add peer to WireGuard on VPS
    const peerResult = await addWgPeer(publicKey);

    if (!peerResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to provision WireGuard peer: ${peerResult.error}`,
        },
        { status: 500 }
      );
    }

    const assignedIp = peerResult.data!.assignedIp;
    const subnetPrefix = tunnelSubnet.split("/")[1] || "24";

    // Build RouterOS commands with assigned values
    const commands = [
      `/interface/wireguard\nadd name=wg0 listen-port=13231`,
      `/ip/address\nadd address=${assignedIp}/${subnetPrefix} interface=wg0`,
      `/interface/wireguard/peers\nadd interface=wg0 public-key="${
        serverPublicKey || "YOUR_VPS_PUBLIC_KEY"
      }" endpoint-address=${
        serverEndpoint || "YOUR_VPS_IP"
      } endpoint-port=51820 allowed-address=10.10.10.1/32 persistent-keepalive=25s`,
      `/ip/firewall/filter\nadd chain=input in-interface=wg0 action=accept place-before=0`,
    ];

    return NextResponse.json({
      success: true,
      data: {
        assignedIp,
        alreadyExists: peerResult.data!.alreadyExists,
        commands,
        note: serverPublicKey
          ? null
          : "VPS public key not configured. Ask your superadmin to update platform settings.",
      },
    });
  } catch (error) {
    console.error("Provision error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
