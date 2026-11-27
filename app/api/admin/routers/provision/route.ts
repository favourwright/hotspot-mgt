import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  handleAuthError,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { assertWithinPlanLimit } from "@/lib/plan-resource-limit-check";
import { provisionPeer } from "@/lib/wg-peers";
import { rateLimit } from "@/lib/rate-limit";
import { getPlatformConfig } from "@/lib/platform-config";

const provisionSchema = z.object({
  publicKey: z.string().min(10),
  // Client-generated per-attempt interface name (e.g. "wg-hm-a3f9k2") - never
  // hardcoded, so this can't collide with anything already on the tenant's router.
  interfaceName: z.string().min(1),
});


/**
 * First usable host of a CIDR block, e.g. "10.20.0.0/24" -> "10.20.0.1".
 * Falls back to the literal input when it isn't parseable, so a misconfigured
 * subnet surfaces in the generated command rather than silently becoming a
 * wrong-but-plausible address.
 */
function firstHostOf(cidr: string): string {
  const [base, bits] = cidr.split("/");
  const octets = base.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return base || cidr;
  }
  const prefix = Number(bits);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return base;

  const asInt = ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (asInt & mask) >>> 0;
  const first = (network + 1) >>> 0;
  return [first >>> 24, (first >>> 16) & 255, (first >>> 8) & 255, first & 255].join(".");
}

/** Per tenant: a few wizard retries, not a loop. */
const PROVISION_LIMIT = { max: 10, windowMs: 60 * 60 * 1000 };

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await requireUnlockedOwner(authHeader);

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

    // Each new key costs an address in the one subnet every tenant shares.
    // The pending cap in lib/wg-peers.ts bounds what is held; this bounds
    // how fast addresses are churned through it.
    if (!rateLimit(`wg-provision:${tenantId}`, PROVISION_LIMIT).ok) {
      return NextResponse.json(
        { success: false, error: "Too many attempts. Wait a few minutes and try again." },
        { status: 429 }
      );
    }

    // Here as well as on the create, because this is where a registration
    // first costs something: a peer on the VPS and commands on their router.
    await assertWithinPlanLimit(tenantId, "maxRouters");

    const platformConfig = await getPlatformConfig();
    const { serverPublicKey, serverEndpoint, tunnelSubnet } =
      platformConfig.wireguard;

    const peer = await provisionPeer(tenantId, publicKey);
    const assignedIp = peer.assignedIp;
    const prefix = tunnelSubnet.split("/")[1] || "24";
    // The VPS's own address inside the tunnel subnet -- the only destination
    // the router needs to reach through this peer. Derived rather than
    // hardcoded: tenants who already run WireGuard to this same server (for
    // Mikhmon, say) must be given a subnet that doesn't collide with theirs,
    // and a hardcoded 10.10.10.1 silently put every router back on the
    // shared one. Two connected routes for one subnet is an ECMP split that
    // breaks both tunnels.
    const serverTunnelIp = firstHostOf(tunnelSubnet);

    // Note: the interface itself (`/interface/wireguard add name=...`) was
    // already created by the tenant earlier in the wizard, before this route
    // is ever called - it's not repeated here to avoid a "already exists" error.
    const commands = [
      `/ip/address\nadd address=${assignedIp}/${prefix} interface=${interfaceName}`,
      `/interface/wireguard/peers\nadd interface=${interfaceName} public-key="${
        serverPublicKey || "YOUR_VPS_PUBLIC_KEY"
      }" endpoint-address=${
        serverEndpoint || "YOUR_VPS_IP"
      } endpoint-port=51820 allowed-address=${serverTunnelIp}/32 persistent-keepalive=25s`,
      `/ip/firewall/filter\nadd chain=input in-interface=${interfaceName} action=accept place-before=0`,
    ];

    return NextResponse.json({
      success: true,
      data: {
        assignedIp,
        alreadyExists: peer.alreadyExists,
        commands,
        configComplete: !!serverPublicKey && !!serverEndpoint,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
