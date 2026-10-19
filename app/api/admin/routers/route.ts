import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import {
  handleAuthError,
  verifyTenantAccessBySlug,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";
import { testRouterConnection } from "@/lib/mikrotik";

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

    const data = validation.data;

    // Always test credentials regardless of connection method
    const testResult = await testRouterConnection({
      ip: data.routerIp,
      username: data.routerUser,
      password: data.routerPass,
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

    await routerRef.set({
      ...data,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      data: { id: routerRef.id, ...data },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
