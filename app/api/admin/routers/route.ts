import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { routerAddressProblem } from "@/lib/router-address";
import { adminDb } from "@/lib/firebase-admin";
import {
  AuthError,
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { assertWithinPlanLimit, planLimitCheck } from "@/lib/plan-resource-limit-check";
import { createWithinCapacity } from "@/lib/tenant-capacity";
import { assertTunnelAddressOwned, readPeerForClaim, ROUTER_TEST_LIMIT } from "@/lib/wg-peers";
import { rateLimit } from "@/lib/rate-limit";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { routerPasswordFields } from "@/lib/router-credentials";
import { testRouterConnection } from "@/lib/mikrotik";
import { invalidateTenantFleet } from "@/lib/tenant-fleet";

const createRouterSchema = z.object({
  name: z.string().min(2),
  connectionMethod: z.enum(["wireguard", "direct"]),
  routerIp: z.string(),
  routerUser: z.string().min(1),
  routerPass: z.string().min(1),
  wireguardPublicKey: z.string().nullable().optional(),
  wireguardTunnelIp: z.string().nullable().optional(),
  wireguardInterfaceName: z.string().nullable().optional(),
  wireguardListenPort: z.number().int().nullable().optional(),
  status: z.enum(["pending", "online", "offline"]).default("pending"),
});

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);

    const snapshot = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .orderBy("createdAt", "desc")
      .get();

    const routers = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        connectionMethod: data.connectionMethod,
        routerIp: data.routerIp,
        wireguardTunnelIp: data.wireguardTunnelIp || null,
        status: data.status,
        active: data.active,
        createdAt: data.createdAt?.toDate()?.toISOString(),
        // NEVER return routerUser or routerPass
      };
    });

    return NextResponse.json({
      success: true,
      data: routers,
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await requireUnlockedOwner(authHeader);

    const body = await request.json();
    const validation = createRouterSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.issues[0].message,
        },
        { status: 400 }
      );
    }

    // Split off here so the password cannot reach a document or a response by spread.
    const { routerPass, ...data } = validation.data;

    const addressProblem = routerAddressProblem(data.routerIp, data.connectionMethod);
    if (addressProblem) {
      return NextResponse.json({ success: false, error: addressProblem }, { status: 400 });
    }

    // Early, before the connection test spends anything. The transaction
    // below is what actually holds the line.
    await assertWithinPlanLimit(tenantId, "maxRouters");

    if (data.connectionMethod === "wireguard" && !data.wireguardPublicKey) {
      return NextResponse.json(
        { success: false, error: "A tunnel router needs the public key it was connected with." },
        { status: 400 }
      );
    }

    // The test below is a login attempt on whatever address was sent, so it
    // gets the same guards as the connection test routes: a limit per
    // tenant, and a tunnel address only if it is this tenant's.
    if (!rateLimit(`router-test:${tenantId}`, ROUTER_TEST_LIMIT).ok) {
      return NextResponse.json(
        { success: false, error: "Too many connection tests. Wait a few minutes and try again." },
        { status: 429 }
      );
    }
    await assertTunnelAddressOwned(tenantId, data.routerIp);

    // Always test credentials regardless of connection method
    const testResult = await testRouterConnection({
      ip: data.routerIp,
      username: data.routerUser,
      password: routerPass,
    });

    if (!testResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Credential verification failed: ${testResult.error}`,
        },
        { status: 400 }
      );
    }

    const routerRef = adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc();

    // A tunnel router sits on the address its peer was given, read from the
    // peer ledger rather than the request: a tenant may only put a router on
    // a tunnel provisioned for them (lib/wg-peers.ts).
    let peer: Awaited<ReturnType<typeof readPeerForClaim>> | null = null;
    await createWithinCapacity({
      tenantId,
      resource: "routers",
      checks: [await planLimitCheck(tenantId, "maxRouters")],
      extra: async (tx) => {
        if (data.connectionMethod !== "wireguard") return;
        peer = await readPeerForClaim(tx, tenantId, data.wireguardPublicKey!);
        const host = data.routerIp.split(":")[0];
        if (host !== peer.assignedIp) {
          throw new AuthError(
            "This router's address does not match its tunnel. Go back a step and connect the tunnel again.",
            400
          );
        }
      },
      write: (tx) => {
        tx.create(routerRef, {
          ...data,
          ...(peer ? { wireguardTunnelIp: peer.assignedIp } : {}),
          ...routerPasswordFields(routerPass),
          active: true,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        peer?.claim(routerRef.id);
      },
    });
    invalidateTenantFleet(tenantId);

    return NextResponse.json({
      success: true,
      // Named fields, never the spread: `data` carries routerUser.
      data: {
        id: routerRef.id,
        name: data.name,
        connectionMethod: data.connectionMethod,
        routerIp: data.routerIp,
        wireguardTunnelIp: data.wireguardTunnelIp ?? null,
        status: data.status,
        active: true,
      },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
