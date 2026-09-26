import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyOwnerWithTenant,
  handleAuthError,
} from "@/lib/auth-helpers";
import { addWgPeer } from "@/lib/wg-manager";
import { getPlatformConfig } from "@/lib/platform-config";

const provisionSchema = z.object({
  publicKey: z.string().min(10),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    await verifyOwnerWithTenant(authHeader);

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

    const platformConfig = await getPlatformConfig();
    const { serverPublicKey, serverEndpoint, tunnelSubnet } =
      platformConfig.wireguard;

    const peerResult = await addWgPeer(publicKey);

    if (!peerResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Provisioning failed: ${peerResult.error}`,
        },
        { status: 500 }
      );
    }

    const assignedIp = peerResult.data!.assignedIp;
    const prefix = tunnelSubnet.split("/")[1] || "24";

    const commands = [
      `/interface/wireguard\nadd name=wg0 listen-port=13231`,
      `/ip/address\nadd address=${assignedIp}/${prefix} interface=wg0`,
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
        configComplete: !!serverPublicKey && !!serverEndpoint,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
