import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/firebase-admin";
import { createHotspotUser } from "@/lib/mikrotik";
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

    const mikrotikResult = await createHotspotUser(routerConfig, {
      username: voucher.username,
      password: voucher.password,
      profile: plan?.mikrotikProfile || "",
      comment: "vc",
      dataLimit: plan?.dataLimit,
    });

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
