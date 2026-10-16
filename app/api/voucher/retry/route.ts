import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import {
  createHotspotUser,
  findHotspotUser,
  updateHotspotUser,
} from "@/lib/mikrotik";
import { formatRouterExpiryComment } from "@/lib/hotspot-users";
import { TENANT_COLLECTIONS } from "@/lib/firebase-collections";
import { verifyOwnerWithTenant, handleAuthError } from "@/lib/auth-helpers";
import { FieldValue } from "firebase-admin/firestore";
import { notifyVoucherActivated } from "@/lib/notifications";

const retrySchema = z.object({
  voucherId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const verifiedUser = await verifyOwnerWithTenant(authHeader);
    const { tenantId } = verifiedUser;

    // Validate input
    const body = await request.json();
    const validation = retrySchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { voucherId } = validation.data;

    // Fetch voucher
    const voucherDoc = await adminDb
      .collection(TENANT_COLLECTIONS.vouchers(tenantId))
      .doc(voucherId)
      .get();

    if (!voucherDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Voucher not found" },
        { status: 404 }
      );
    }

    const voucher = voucherDoc.data();

    if (voucher?.status !== "failed") {
      return NextResponse.json(
        { success: false, error: "Voucher is not in failed status" },
        { status: 400 }
      );
    }

    // Fetch location
    const locationDoc = await adminDb
      .collection(TENANT_COLLECTIONS.locations(tenantId))
      .doc(voucher.locationId)
      .get();

    if (!locationDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    const location = locationDoc.data();

    if (!location?.active) {
      return NextResponse.json(
        { success: false, error: "Location is not active" },
        { status: 400 }
      );
    }

    // Fetch router credentials via location's routerId
    const routerDoc = await adminDb
      .collection(TENANT_COLLECTIONS.routers(tenantId))
      .doc(location.routerId)
      .get();

    if (!routerDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Router not found" },
        { status: 404 }
      );
    }

    const routerData = routerDoc.data()!;

    // Verify router is active
    if (!routerData.active) {
      return NextResponse.json(
        { success: false, error: "Router is not active" },
        { status: 400 }
      );
    }

    // Fetch plan
    const planDoc = await adminDb
      .collection(TENANT_COLLECTIONS.plans(tenantId))
      .doc(voucher.planId)
      .get();

    if (!planDoc.exists) {
      return NextResponse.json(
        { success: false, error: "Plan not found" },
        { status: 404 }
      );
    }

    const plan = planDoc.data();

    // Attempt to create hotspot user on MikroTik with EXISTING credentials
    const routerConfig = {
      ip: routerData.routerIp,
      username: routerData.routerUser,
      password: routerData.routerPass,
    };

    // A failed *renewal* must not be retried as a creation. It shares its
    // username with the voucher it was topping up, which is still on the
    // router and still working, so creating it again fails on the duplicate
    // name - and if it somehow did not, it would replace a credential the
    // customer is using right now.
    //
    // `expiresAt` and `dataLimitBytes` were computed and stored before the
    // first attempt touched the router, precisely so this retry can send
    // the same two absolute numbers rather than recomputing "what is there
    // now, plus the plan" and topping the customer up twice.
    const isRenewal = Boolean(voucher.renewalOf);

    let mikrotikResult;

    if (isRenewal) {
      const expiresAt =
        voucher.expiresAt?.toDate?.() ??
        (voucher.expiresAt ? new Date(voucher.expiresAt) : null);

      const found = await findHotspotUser(routerConfig, voucher.username);

      if (!expiresAt || !found.success || !found.data) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This renewal cannot be retried automatically - the login it was topping up is no longer on the router. Issue a new voucher instead.",
          },
          { status: 400 }
        );
      }

      const comment = formatRouterExpiryComment(expiresAt, found.data.comment);
      if (!comment) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This renewal cannot be retried automatically - the login's expiry on the router is in a format we cannot safely rewrite.",
          },
          { status: 400 }
        );
      }

      const patch: Record<string, string> = {
        comment,
        "limit-bytes-total": String(voucher.dataLimitBytes ?? 0),
      };
      if (found.data["limit-uptime"] === "1s") {
        patch["limit-uptime"] = "0";
      }

      mikrotikResult = await updateHotspotUser(
        routerConfig,
        voucher.username,
        patch
      );
    } else {
      mikrotikResult = await createHotspotUser(routerConfig, {
        username: voucher.username,
        password: voucher.password,
        profile: plan?.mikrotikProfile || "",
        comment: "vc",
        dataLimit: plan?.dataLimit,
      });
    }

    if (mikrotikResult.success) {
      // Success - update voucher to active
      await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .doc(voucherId)
        .update({
          status: "active",
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
          failureReason: FieldValue.delete(),
        });

      // A renewal that lands on the retry still has to close out the
      // voucher it replaced, which the first attempt never got to. Without
      // this the old document stays "active" and the expiry cron emails the
      // customer about an end date that no longer applies.
      if (isRenewal && voucher.renewalOf) {
        await adminDb
          .collection(TENANT_COLLECTIONS.vouchers(tenantId))
          .doc(voucher.renewalOf)
          .update({
            status: "superseded",
            supersededAt: FieldValue.serverTimestamp(),
            supersededBy: voucherId,
          });
      }

      // Delivers the credentials that could not reach the customer the first
      // time round - the whole point of the retry from their side.
      await notifyVoucherActivated({
        tenantId,
        customerEmail: voucher.userEmail,
        planName: voucher.planName,
        locationName: voucher.locationName,
        username: voucher.username,
        password: voucher.password,
        duration: voucher.duration,
        dataLimit: voucher.dataLimit,
        sharedUsers: voucher.sharedUsers,
      });

      return NextResponse.json({
        success: true,
        message: "Voucher activated successfully",
      });
    } else {
      // Failed again - update failure info
      await adminDb
        .collection(TENANT_COLLECTIONS.vouchers(tenantId))
        .doc(voucherId)
        .update({
          failureReason: mikrotikResult.error || "Unknown error",
          retryCount: FieldValue.increment(1),
          lastRetryAt: FieldValue.serverTimestamp(),
        });

      return NextResponse.json(
        {
          success: false,
          error: mikrotikResult.error || "Failed to create hotspot user",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Voucher retry error:", error);
    const { message, status } = handleAuthError(error);
    return NextResponse.json(
      { success: false, error: message },
      { status }
    );
  }
}
