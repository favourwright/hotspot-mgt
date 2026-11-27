import { NextRequest, NextResponse } from "next/server";
import {
  verifyTenantAccessBySlug,
  handleAuthError,
  TENANT_SLUG_HEADER,
} from "@/lib/auth-helpers";
import { requireUnlockedOwner } from "@/lib/billing-lock";
import { getHotspotUserDetail } from "@/lib/hotspot-user-detail";
import { getRouterForLocation } from "@/lib/router-config";
import { deleteHotspotUser } from "@/lib/mikrotik";
import { adminDb } from "@/lib/firebase-admin";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { FieldValue } from "firebase-admin/firestore";

// One user's full detail, fetched when the dialog opens rather than being
// carried in the list response - it includes the password.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; username: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const tenantSlug = request.headers.get(TENANT_SLUG_HEADER);
    const { tenantId } = await verifyTenantAccessBySlug(authHeader, tenantSlug);

    const { id: locationId, username } = await params;
    const detail = await getHotspotUserDetail(
      tenantId,
      locationId,
      decodeURIComponent(username)
    );

    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * Removes a hotspot user from the router.
 *
 * This is the destructive half of reconciling drift. On the router it
 * deletes; in Firestore it only records who did it (below) and leaves the
 * voucher otherwise alone. Deleting the
 * voucher instead would quietly change how much the tenant has ever sold
 * (every dashboard counts that collection live), strand the payment that
 * points at it, and take away the customer's own copy of something they
 * paid for. Dismissing a stale row is a separate, reversible archive.
 *
 * Two conditions make this dangerous rather than merely destructive, and
 * both are checked here rather than only in the confirmation dialog -- a
 * client-side guard is a courtesy, not a control:
 *
 *  - the user is tied to a voucher that is still live, so deleting it takes
 *    away access someone has paid for and recreates the exact drift this is
 *    meant to clear;
 *  - the user is connected right now, so deleting it disconnects them
 *    mid-session.
 *
 * Either one answers 409 with the reasons named, and the caller has to come
 * back with `?force=true` having shown them to a human.
 *
 * Owner-only: `verifyTenantAccessBySlug` lets a superadmin *view* a tenant,
 * and writes deliberately stay on `requireUnlockedOwner` (which is
 * `verifyOwnerWithTenant` plus the billing lock) so that stays read-only.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; username: string }> }
) {
  try {
    const authHeader = request.headers.get("authorization");
    const { tenantId } = await requireUnlockedOwner(authHeader);

    const { id: locationId, username: rawUsername } = await params;
    const username = decodeURIComponent(rawUsername);
    const force = request.nextUrl.searchParams.get("force") === "true";

    const detail = await getHotspotUserDetail(tenantId, locationId, username);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: "Location or its router was not found" },
        { status: 404 }
      );
    }

    // An unreachable router can't be distinguished from an empty one, and
    // "not found" there would be a lie that invites a pointless delete.
    if (!detail.routerReachable) {
      return NextResponse.json(
        {
          success: false,
          error: detail.routerError || "The router is unreachable right now.",
        },
        { status: 503 }
      );
    }

    if (!detail.foundOnRouter) {
      return NextResponse.json(
        { success: false, error: "This user is no longer on the router." },
        { status: 404 }
      );
    }

    const blockers: string[] = [];

    // `expiresAt` is null for most live vouchers -- it is only stamped once
    // the plan actually starts -- so a null is treated as "not expired yet",
    // which is the cautious reading.
    const voucherIsLive =
      detail.voucher?.status === "active" &&
      (!detail.expiresAt || new Date(detail.expiresAt) > new Date());

    if (voucherIsLive) {
      blockers.push(
        `${detail.voucher!.customerEmail} has a live ${detail.voucher!.planName} voucher for this user. Deleting it takes away access they paid for.`
      );
    }
    if (detail.session) {
      blockers.push(
        `This user is connected right now (${detail.session.macAddress}) and will be disconnected.`
      );
    }

    if (blockers.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: "This user can't be deleted without confirmation.",
          data: { blockers },
        },
        { status: 409 }
      );
    }

    const router = await getRouterForLocation(tenantId, locationId);
    if (!router) {
      return NextResponse.json(
        { success: false, error: "Router not found for this location" },
        { status: 404 }
      );
    }

    const result = await deleteHotspotUser(router.config, username);
    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error || "The router refused the delete." },
        { status: 502 }
      );
    }

    // Recorded on the live voucher, the same way the reaper records its own
    // deletes. Without it this delete is indistinguishable from one nobody
    // can account for: the Users page would list it as drift, and for a
    // plan still running router-health would email the owner about a login
    // they removed themselves a few minutes earlier. Never fails the
    // delete, which has already happened on the router.
    if (detail.voucher) {
      try {
        await adminDb
          .collection(TENANT_COLLECTIONS.vouchers(tenantId))
          .doc(detail.voucher.id)
          .update({
            routerUserReapedAt: FieldValue.serverTimestamp(),
            routerUserRemovedBy: "owner",
            routerUserMissingSince: null,
          });
      } catch (error) {
        console.error(
          `[hotspot-users] recording the delete of ${username} on voucher ${detail.voucher.id}:`,
          error
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: { username, forced: blockers.length > 0 },
    });
  } catch (error) {
    const { message, status } = handleAuthError(error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
