import { NextRequest, NextResponse } from "next/server";

import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyAuthenticated, handleAuthError } from "@/lib/auth-helpers";
import { getRouterForLocation } from "@/lib/router-config";
import {
  findHotspotUser,
  findActiveSessionForUser,
  parseDataLimitBytes,
} from "@/lib/mikrotik";

export interface VoucherUsage {
  /** False when the router couldn't be reached; the rest is then unknown. */
  routerReachable: boolean;
  /** The voucher exists here but the router has no such user any more. */
  foundOnRouter: boolean;
  /** Data allowance in bytes, null when the plan is unmetered. */
  limitBytesTotal: number | null;
  bytesUsed: number | null;
  /** Time allowance and consumption, as MikroTik duration strings. */
  limitUptime: string | null;
  uptimeUsed: string | null;
  /** True while the device is connected right now. */
  online: boolean;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * How much of their own voucher a customer has used.
 *
 * The same numbers the owner sees in the admin dialog, deliberately narrowed
 * to what the person who bought it needs: allowance, consumption, and
 * whether they are connected. No password, no profile, no comment, nothing
 * about the router itself -- this is reachable by any signed-in customer, so
 * it returns the smallest thing that answers the question.
 *
 * Ownership is checked against the voucher document rather than trusted from
 * the request: the tenant comes from the caller's own voucher, so there is no
 * tenant id in the URL to tamper with, and a voucher belonging to someone
 * else answers 404 rather than 403 -- a customer has no business learning
 * which voucher ids exist.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const user = await verifyAuthenticated(authHeader);

    const { id: voucherId } = await params;
    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: "tenantId is required" },
        { status: 400 }
      );
    }

    const voucherDoc = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(voucherId)
      .get();
    const voucher = voucherDoc.data();

    if (!voucherDoc.exists || !voucher || voucher.userId !== user.uid) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    const router = await getRouterForLocation(tenantId, voucher.locationId);
    if (!router) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    const [found, session] = await Promise.all([
      findHotspotUser(router.config, voucher.username),
      findActiveSessionForUser(router.config, voucher.username),
    ]);

    if (!found.success) {
      // Unreachable is reported, not failed: the page still has everything
      // from the voucher itself and should render that rather than an error.
      const usage: VoucherUsage = {
        routerReachable: false,
        foundOnRouter: false,
        limitBytesTotal: null,
        bytesUsed: null,
        limitUptime: null,
        uptimeUsed: null,
        online: false,
      };
      return NextResponse.json({ success: true, data: usage });
    }

    const hotspotUser = found.data;
    const bytesIn = toNumber(hotspotUser?.["bytes-in"]);
    const bytesOut = toNumber(hotspotUser?.["bytes-out"]);

    const usage: VoucherUsage = {
      routerReachable: true,
      foundOnRouter: hotspotUser !== null,
      // The router first, since that is what is actually enforced. The
      // voucher's own allowance is the fallback: a customer sold "5GB" was
      // told that on the portal, in checkout and by email, so reporting
      // "No limit set" because the router record happens to lack the cap
      // contradicts every other place they have seen it.
      limitBytesTotal:
        toNumber(hotspotUser?.["limit-bytes-total"]) ??
        parseDataLimitBytes(voucher.dataLimit),
      bytesUsed:
        bytesIn === null && bytesOut === null
          ? null
          : (bytesIn ?? 0) + (bytesOut ?? 0),
      limitUptime: hotspotUser?.["limit-uptime"] ?? null,
      uptimeUsed: hotspotUser?.uptime ?? null,
      online: session.success && session.data !== null,
    };

    return NextResponse.json({ success: true, data: usage });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
