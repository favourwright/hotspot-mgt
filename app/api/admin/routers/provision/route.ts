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
  // Client-generated per-attempt interface name (e.g. "wg-hm-a3f9k2") - never
  // hardcoded, so this can't collide with anything already on the tenant's router.
  interfaceName: z.string().min(1),
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

    const { publicKey, interfaceName } = validation.data;

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

    // Note: the interface itself (`/interface/wireguard add name=...`) was
    // already created by the tenant earlier in the wizard, before this route
    // is ever called - it's not repeated here to avoid a "already exists" error.
    const commands = [
      `/ip/address\nadd address=${assignedIp}/${prefix} interface=${interfaceName}`,
      `/interface/wireguard/peers\nadd interface=${interfaceName} public-key="${
        serverPublicKey || "YOUR_VPS_PUBLIC_KEY"
      }" endpoint-address=${
        serverEndpoint || "YOUR_VPS_IP"
      } endpoint-port=51820 allowed-address=10.10.10.1/32 persistent-keepalive=25s`,
      `/ip/firewall/filter\nadd chain=input in-interface=${interfaceName} action=accept place-before=0`,
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
